importScripts("demuxer_mp4.js");


class DecodeFileToStream {

    samples = [];

    constructor(file, videoWriter) {
        this.file = file;
        this.kind = "video";
        this.writer = videoWriter;
        this.offset = 0;
        this.rendering = false;

        // mp4box setup
        this.fs = MP4Box.createFile();

        // handles the initial buffer load
        this.fs.write = chunk => {
            // console.log(`wrote chunk with length ${chunk.byteLength}`)

            // MP4Box.js requires buffers to be Uint8Array, but we have a ArrayBuffers.
            const buffer = new ArrayBuffer(chunk.byteLength);
            new Uint8Array(buffer).set(chunk);

            // Inform MP4Box where in the file this chunk is from.
            buffer.fileStart = this.offset;
            this.offset += buffer.byteLength;

            // Append chunk.
            this.fs.appendBuffer(buffer);
        }
        this.fs.close = () => this.fs.flush();
        this.fs.onError = e => console.error(e);
        this.fs.onReady = info => {
            console.log("loaded track(s)", info);
            const trackInfo = info.videoTracks[0];
            const track = this.fs.getTrackById(trackInfo.id);
            const config = {
                codec: trackInfo.codec.startsWith('vp08') ? 'vp8' : trackInfo.codec,
                codedHeight: trackInfo.video.height,
                codedWidth: trackInfo.video.width,
                description: getDescription(track)
            };

            console.log("codec config", config);
            this.decoder.configure(config);
            this.fs.setExtractionOptions(trackInfo.id);

        }
        this.fs.onSamples = async (trackId, ref, samples) => {
            console.log(`loaded ${samples.length} samples`);
            this.samples.push(...samples);
            if (!this.rendering) {
                this.rendering = true;
                this.#renderLoop();
            }
        }

        this.fs.start();

        this.fileLoader(file)
            .then(() => console.log(`loaded file ${file}`))
            .catch(e => console.error(e));
    }

    async fileLoader(fileUrl) {
        // load the file into mp4box
        const file = await fetch(fileUrl);
        await file.body.pipeTo(new WritableStream(this.fs, {highWaterMark: 2}));
    }

    // decoder setup
    decoder = new VideoDecoder({
        output: frame => this.writer.write(frame),
        error: e => console.error(e)
    });

    /**
     * Decodes a mp4bbox sample by turning it into a EncodedVideoChunk and passing it to the decoder
     * @param sample - mp4box sample
     * @returns number - the duration of the sample in ms
     */
    #decodeSample(sample) {
        const duration = 1e6 * sample.duration / sample.timescale;
        const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: 1e6 * sample.cts / sample.timescale,
            duration: duration,
            data: sample.data
        });
        this.decoder.decode(chunk);
        return duration / 1000;
        // return new Promise(resolve => setTimeout(resolve, duration));
    }

    #renderLoop() {
        if (this.samples.length > 0) {
            const duration = this.#decodeSample(this.samples.shift());
            setTimeout(this.#renderLoop, duration);
        } else {
            console.log("done rendering");
            this.rendering = false;
        }
    }

    // Get the appropriate `description` for a specific track. Assumes that the
    // track is H.264, H.265, VP8, VP9, or AV1.
    getDescription(track) {
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


}

// Get the appropriate `description` for a specific track. Assumes that the
// track is H.264, H.265, VP8, VP9, or AV1.
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


function getAudioSpecificConfig(file) {
    // TODO: make sure this is coming from the right track.

    /*
    // 0x04 is the DecoderConfigDescrTag. Assuming MP4Box always puts this at position 0.
    console.assert(file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0].tag == 0x04);
    // 0x40 is the Audio OTI, per table 5 of ISO 14496-1
    console.assert(file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0].oti == 0x40);
    // 0x05 is the DecSpecificInfoTag
    console.assert(file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0].descs[0].tag == 0x05);
     */

    return file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0].descs[0].data;
}


async function start(data) {
    const videoSamples = [];
    const audioSamples = [];
    const fileUrl = data.file;
    const videoWriter = data.videoWriter.getWriter();
    const audioWriter = data.audioWriter.getWriter();
    let offset = 0;
    let rendering = false;


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
     * Decodes a mp4bbox sample by turning it into a EncodedVideoChunk and passing it to the decoder
     * @param sample - mp4box sample
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


    // Decode and loop, waiting for each sample's duration before decoding the next.
    // NOTE: at 1000 samples/second, the audio one has a hard time keeping up
    function renderVideoLoop() {
        if (videoSamples.length > 0) {
            const duration = decodeVideoSample(videoSamples.shift());
            setTimeout(renderVideoLoop, duration);
        } else {
            console.log("done rendering video");
            rendering = false;
        }
    }

    function renderAudioLoop() {
        if(audioSamples.length === 1000)
            console.log("audioSamples", audioSamples[0]);

        if (audioSamples.length > 0) {
            const duration = decodeAudioSample(audioSamples.shift());
            setTimeout(renderAudioLoop, duration);
        } else {
            console.log("done rendering audio");
            rendering = false;
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
    fs.close = () => fs.flush();
    fs.onError = e => console.error(e);
    fs.onReady = info => {
        console.log("loaded track(s)", info);

        // Video
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

        // Audio
        const audioTrackInfo = info.audioTracks[0];
        const audioTrack = fs.getTrackById(audioTrackInfo.id);
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
    fs.onSamples = async (trackId, ref, samples) => {
        console.log(`loaded ${samples.length} samples from track ${trackId}`);
        if (trackId === 1) {
            videoSamples.push(...samples);
        } else if (trackId === 2) {
            audioSamples.push(...samples);
        }

        // start rendering once there is a queue of samples
        if (!rendering && videoSamples.length > 0 && audioSamples.length > 0) {
            rendering = true;
            renderVideoLoop();
            renderAudioLoop();
        }
    }

    fs.start();

    // load the file into mp4box as a stream
    const file = await fetch(fileUrl);
    await file.body.pipeTo(new WritableStream(fs, {highWaterMark: 2}));

}


self.addEventListener("message", async message => await start(message.data), {once: true});
