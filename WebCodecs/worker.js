importScripts("demuxer_mp4.js");

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




async function start(data) {
    const allSamples = [];
    const fileUrl = data.file;
    const writer = data.videoWriter.getWriter();
    let offset = 0;
    let rendering = false;


    // decoder setup
    const decoder = new VideoDecoder({
        output: frame => writer.write(frame),
        error: e => console.error(e)
    });

    /**
     * Decodes a mp4bbox sample by turning it into a EncodedVideoChunk and passing it to the decoder
     * @param sample - mp4box sample
     * @returns number - the duration of the sample in ms
     */
    function decodeSample(sample){
        const duration = 1e6 * sample.duration / sample.timescale;
        const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: 1e6 * sample.cts / sample.timescale,
            duration: duration,
            data: sample.data
        });
        decoder.decode(chunk);
        return duration / 1000;
        // return new Promise(resolve => setTimeout(resolve, duration));
    }

    function renderLoop(){
        if(allSamples.length > 0){
            const duration = decodeSample(allSamples.shift());
            setTimeout(renderLoop, duration);
        }
        else {
            console.log("done rendering");
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
        const trackInfo = info.videoTracks[0];
        const track = fs.getTrackById(trackInfo.id);
        const config = {
            codec: trackInfo.codec.startsWith('vp08') ? 'vp8' : trackInfo.codec,
            codedHeight: trackInfo.video.height,
            codedWidth: trackInfo.video.width,
            description: getDescription(track)
        };

        console.log("codec config", config);
        decoder.configure(config);
        fs.setExtractionOptions(trackInfo.id);

    }
    fs.onSamples = async (trackId, ref, samples) => {
        console.log(`loaded ${samples.length} samples`);
        allSamples.push(...samples);
        if(!rendering){
            rendering = true;
            renderLoop();
        }
    }

    fs.start();

    // load the file into mp4box
    const file = await fetch(fileUrl);
    await file.body.pipeTo(new WritableStream(fs, {highWaterMark: 2}));

    await new Promise(resolve => setTimeout(resolve, 1000));

    // console.log("sample example: ", allSamples[0]);

    /*
    for (const sample of allSamples) {
        await decodeSample(sample);
        await new Promise(resolve => setTimeout(resolve, 1000/30));
    }
     */


    /*
    // Fetch and demux the media data.
    const demuxer = new MP4Demuxer(file, {
        onConfig(config) {
            console.log("decode", `${config.codec} @ ${config.codedWidth}x${config.codedHeight}`);
            decoder.configure(config);
        },
        onChunk(chunk) {
            decoder.decode(chunk);
        },
        setStatus(type, message) { console.log(`${type}: ${message}`)}
    });

     */

}

self.addEventListener("message", async message => await start(message.data), {once: true});
