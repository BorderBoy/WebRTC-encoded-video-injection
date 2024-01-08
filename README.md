# Encoded Video Injection
This is a proof of concept of replacing encoded video frames in a WebRTC connection with pre-encoded H.264 video. This is done by using the [RTCRtpScriptTransform API](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpScriptTransform), also called [WebRTC Encoded Transform](https://www.w3.org/TR/webrtc-encoded-transform/).

## How to run?
To run the page locally
```
npm install && npm start
```
and open your browser on the page indicated.

### Video File
The site allows you to upload a file of a pre-encoded video which will replace the frames coming from the camera and which will be looped. The file is expected to contain the the NAL units of a H.264 encoded video in Annex B format (see https://www.w3.org/TR/webrtc-encoded-transform/#RTCEncodedVideoFrame-members). Make sure you are using the "baseline" profile when encoding.

To generate a fitting file with ffmpeg, you can do:
`ffmpeg -i [input] -profile:v baseline [output].h264`

If you don't upload a video file your camera feed will be used as usual.

## Attribution
This repo is based on the [WebRTC samples repo](https://github.com/webrtc/samples), especially the end-to-end encryption example.