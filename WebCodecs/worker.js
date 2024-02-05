// mp4box.js used for demuxing - https://github.com/gpac/mp4box.js
// min version here: https://gpac.github.io/mp4box.js/dist/mp4box.all.min.js
importScripts("https://gpac.github.io/mp4box.js/dist/mp4box.all.js");

// Get the appropriate `description` for a specific track. Assumes that the track is H.264, H.265, VP8, VP9, or AV1.
function getDescription(track) {
    for (const entry of track.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
            const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            box.write(stream);
            return new Uint8Array(stream.buffer, 8);  // Remove the box header.
        }
    }
    throw new Error("avcC, hvcC, vpcC, or av1C box not found");
}


async function start(data) {
    const videoSamples = [];
    const audioSamples = [];
    const fileRef = data.file;
    const videoWriter = data.videoWriter.getWriter();
    const audioWriter = data.audioWriter.getWriter();
    let offset = 0;
    let rendering = false;

    console.log("starting worker", data);

    // decoder setup
    const videoDecoder = new VideoDecoder({
        output: frame => videoWriter.write(frame),
        error: e => console.error(e)
    });

    const audioDecoder = new AudioDecoder({
        output: frame => audioWriter.write(frame),
        error: e => console.error(e)
    });

    /**
     * Decodes a mp4bbox Video sample by turning it into a EncodedVideoChunk and passing it to the decoder
     * @param sample - mp4box video sample
     * @returns number - the duration of the sample in ms
     */
    function decodeVideoSample(sample) {
        const duration = 1e6 * sample.duration / sample.timescale;
        const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: 1e6 * sample.cts / sample.timescale,
            duration: duration,
            data: sample.data
            //transfer: [sample.data]
        });
        videoDecoder.decode(chunk);
        return duration / 1000;
    }

    function decodeAudioSample(sample) {
        const duration = 1e6 * sample.duration / sample.timescale;
        const chunk = new EncodedAudioChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: 1e6 * sample.cts / sample.timescale,
            duration: duration,
            data: sample.data
        });
        audioDecoder.decode(chunk);
        return duration / 1000;
    }


    // Decode and loop - Video, waiting for each sample's duration before decoding the next.
    // NOTE: the audio one has a hard time keeping up
    function renderVideoLoop() {
        if (videoSamples.length > 0) {
            const duration = decodeVideoSample(videoSamples.shift());
            setTimeout(renderVideoLoop, duration);
        } else {
            console.log("done rendering video");
            rendering = false;
        }
    }


    // Decode and loop - audio, waiting for each sample's duration before decoding the next.
    function renderAudioLoop() {
        /*
        // debugging to help inspect a sample
        if(audioSamples.length === 1000){
            const sample = audioSamples[0];
            console.log("audioSamples", audioSamples[0]);
            console.log("audio duration: " +  1000 * sample.duration / sample.timescale);
        }
         */

        if (audioSamples.length > 0) {
            const duration = decodeAudioSample(audioSamples.shift());
            setTimeout(renderAudioLoop, duration);
        } else {
            console.log("done rendering audio");
            rendering = false;
        }
    }

    // Wait until we have a queue of both audio and video samples before staring the render loops
    function render() {
        if (!rendering && videoSamples.length > 100 && audioSamples.length > 100) {
            console.log("starting rendering");
            rendering = true;
            renderAudioLoop();  // this is about ~1 second behind the video
            renderVideoLoop();
        }
        else {
            // console.log("not enough samples to start rendering");
            setTimeout(render, 1000);
        }
    }

    // mp4box setup
    const fs = MP4Box.createFile();

    // handles the initial buffer load
    fs.write = chunk => {
        // console.log(`wrote chunk with length ${chunk.byteLength}`)

        // MP4Box.js requires buffers to be Uint8Array, but we have a ArrayBuffers.
        const buffer = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(buffer).set(chunk);

        // Inform MP4Box where in the file this chunk is from.
        buffer.fileStart = offset;
        offset += buffer.byteLength;

        // Append chunk.
        fs.appendBuffer(buffer);
    }

    // when mp4box is ready, setup webcodecs with the track info
    fs.onReady = info => {
        console.log("loaded track(s)", info);

        // Video track setup
        const videoTrackInfo = info.videoTracks[0];
        const videoTrack = fs.getTrackById(videoTrackInfo.id);
        const videoConfig = {
            codec: videoTrackInfo.codec.startsWith('vp08') ? 'vp8' : videoTrackInfo.codec,
            codedHeight: videoTrackInfo.video.height,
            codedWidth: videoTrackInfo.video.width,
            description: getDescription(videoTrack)
        };
        console.log("video codec config", videoConfig);
        videoDecoder.configure(videoConfig);
        fs.setExtractionOptions(videoTrackInfo.id);

        // Audio track setup - requires fewer fields than video
        const audioTrackInfo = info.audioTracks[0];
        // const audioTrack = fs.getTrackById(audioTrackInfo.id);
        const audioConfig = {
            codec: audioTrackInfo.codec,
            sampleRate: audioTrackInfo.audio.sample_rate,
            numberOfChannels: audioTrackInfo.audio.channel_count,
            sampleSize: audioTrackInfo.audio.sample_size,
            // description: getAudioSpecificConfig(fs)
        };
        console.log("audio codec config", audioConfig);
        audioDecoder.configure(audioConfig);
        fs.setExtractionOptions(audioTrackInfo.id);
    }

    // clear memory when done
    fs.close = () => fs.flush();

    // handle errors
    fs.onError = e => console.error(e);

    // add incoming samples to the array for the render loop to process
    fs.onSamples = async (trackId, ref, samples) => {
        console.log(`loaded ${samples.length} samples from track ${trackId}`);
        if (trackId === 1) {
            videoSamples.push(...samples);
        } else if (trackId === 2) {
            audioSamples.push(...samples);
        }
        render();
    }


    fs.start();

    // helper to load the file into mp4box as a stream
    // handles download from a URL or loading from a file input
    if(typeof fileRef === "string"){
        // load the file into mp4box as a stream
        const fileContents = await fetch(fileRef);
        await fileContents.body.pipeTo(new WritableStream(fs, {highWaterMark: 2}));
    }
    else{
        const arrayBuffer = await fileRef.arrayBuffer();
        // Convert the ArrayBuffer to a stream for processing
        const fileContents = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(arrayBuffer));
                controller.close();
            }
        });
        await fileContents.pipeTo(new WritableStream(fs, {highWaterMark: 2}));
    }


}

// Start as soon as we get a message
self.addEventListener("message", async message => await start(message.data), {once: true});
