Examples of how to convert a video file to a `MediaStream` where it can be sent via WebRTC.
See [webrtcHacks post](https://webrtchacks.com/all-the-ways-to-…file-over-webrtc) for full details, commentary, and comparisons.

### Examples
- [getDisplayMedia of pop-out video file](screenshare/screenshareVideoPC.html) - load a video file into a pop-up and use `getDisplayMedia` for capture.
- [VideoElement Capture Stream](captureStream/captureStream.html) - capture the video and audio directly from a `video` element. The audio is captured using the Web Audio API and combined with the video stream to create a `MediaStream`.
- [VideoElement Capture Stream with WebAudio](captureStream/captureStreamWebAudio.html) - same as above, but experimenting with using WebAudio for local audio control.
- [Canvas Capture + Web Audio](canvas/canvasCapture.html) - write a source video to a canvas and then use `canvas.captureStream()` to capture the video with Web Audio API to capture the audio.
- [WebCodecs](WebCodecs/decodeToVideo.html) - load a video file and use WebCodecs to convert it to a MediaStream

### Demos
- [getDisplayMedia of pop-out video file](screenshare/screenshareVideoPC.html) - load a video file into a pop-up and use the `getDisplayMedia` for capture.
- [VideoElement Capture Stream](captureStream/captureStream.html) - capture the video and audio directly from a `video` element. The audio is captured using the Web Audio API and combined with the video stream to create a `MediaStream`.
- [VideoElement Capture Stream with WebAudio](captureStream/captureStreamWebAudio.html) - same as above, but experimenting with using WebAudio for local audio control.
- [Canvas Capture + Web Audio](canvas/canvasCapture.html) - write a source video to a canvas and then use `canvas.captureStream()` to capture the video with Web Audio API to capture the audio.
- [WebCodecs](WebCodecs/decodeToVideo.html) - load a video file and use WebCodecs to convert it to a MediaStream


### CREDITS
Big Buck Bunny video converted to 640x360 at 30 fps from [peach.blender.org](https://peach.blender.org/).
