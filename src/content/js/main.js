/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

/* global RTCRtpScriptTransform */
/* global VideoPipe */

const otMeta = document.createElement('meta');
otMeta.httpEquiv = 'origin-trial';
otMeta.content = 'Apqq/1zw8pLqwKbJS8NWagBGg8GZnUAzy1Hpd4qMzC8FTTSYHcZvhnsFzRo2x1mEmTKeNd34GXbLtyePSizwowoAAABdeyJvcmlnaW4iOiJodHRwOi8vMTI3LjAuMC4xOjgwODAiLCJmZWF0dXJlIjoiUlRDRW5jb2RlZEZyYW1lU2V0TWV0YWRhdGEiLCJleHBpcnkiOjE3MTY5NDA3OTl9';
document.head.append(otMeta);

const video1 = document.querySelector('video#video1');
const video2 = document.querySelector('video#video2');

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');

const cryptoKey = document.querySelector('#crypto-key');
const cryptoOffsetBox = document.querySelector('#crypto-offset');
const banner = document.querySelector('#banner');
const muteMiddleBox = document.querySelector('#mute-middlebox');
const videoFile = document.querySelector('#video-file');

startButton.onclick = start;
callButton.onclick = call;
hangupButton.onclick = hangup;

videoFile.addEventListener('change', setVideoStream);

let startToEnd;

let localStream;
// eslint-disable-next-line no-unused-vars
let remoteStream;

// Preferring a certain codec is an expert option without GUI.
// Use opus by default.
// eslint-disable-next-line prefer-const
let preferredAudioCodecMimeType = 'audio/opus';
// Use VP8 by default to limit depacketization issues.
// eslint-disable-next-line prefer-const
let preferredVideoCodecMimeType = 'video/H264';

let hasEnoughAPIs = !!window.RTCRtpScriptTransform;

if (!hasEnoughAPIs) {
  const supportsInsertableStreams =
      !!RTCRtpSender.prototype.createEncodedStreams;

  let supportsTransferableStreams = false;
  try {
    const stream = new ReadableStream();
    window.postMessage(stream, '*', [stream]);
    supportsTransferableStreams = true;
  } catch (e) {
    console.error('Transferable streams are not supported.');
  }
  hasEnoughAPIs = supportsInsertableStreams && supportsTransferableStreams;
}

if (!hasEnoughAPIs) {
  banner.innerText = 'Your browser does not support WebRTC Encoded Transforms. ' +
  'This sample will not work.';
  if (adapter.browserDetails.browser === 'chrome') {
    banner.innerText += ' Try with Enable experimental Web Platform features enabled from chrome://flags.';
  }
  startButton.disabled = true;
  cryptoKey.disabled = true;
  cryptoOffsetBox.disabled = true;
}

function gotStream(stream) {
  console.log('Received local stream');
  video1.srcObject = stream;
  localStream = stream;
  callButton.disabled = false;
}

function gotRemoteStream(stream) {
  console.log('Received remote stream');
  remoteStream = stream;
  video2.srcObject = stream;
}

function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
  const options = {
    audio: false,
    // video: true
    video: {
      frameRate: {
        exact: 30
      }
    }
  };
  navigator.mediaDevices
      .getUserMedia(options)
      .then(gotStream)
      .catch(function(e) {
        alert('getUserMedia() failed');
        console.log('getUserMedia() error: ', e);
      });
}

// We use a Worker to do the encryption and decryption.
// See
//   https://developer.mozilla.org/en-US/docs/Web/API/Worker
// for basic concepts.
const worker = new Worker('./src/content/js/worker.js', {name: 'E2EE worker'});
function setupSenderTransform(sender) {
  if (window.RTCRtpScriptTransform) {
    sender.transform = new RTCRtpScriptTransform(worker, {operation: 'encode'});
    return;
  }

  const senderStreams = sender.createEncodedStreams();
  // Instead of creating the transform stream here, we do a postMessage to the worker. The first
  // argument is an object defined by us, the second is a list of variables that will be transferred to
  // the worker. See
  //   https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
  // If you want to do the operations on the main thread instead, comment out the code below.
  /*
  const transformStream = new TransformStream({
    transform: encodeFunction,
  });
  senderStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(senderStreams.writable);
  */
  const {readable, writable} = senderStreams;
  worker.postMessage({
    operation: 'encode',
    readable,
    writable,
  }, [readable, writable]);

  worker.onmessage = function(event) {
    const arrayBufferFromWorker = event.data.data;
    downloadArrayBuffersAsFile(arrayBufferFromWorker, 'test.h264');
  };
}

function setupReceiverTransform(receiver) {
  if (window.RTCRtpScriptTransform) {
    receiver.transform = new RTCRtpScriptTransform(worker, {operation: 'decode'});
    return;
  }

  const receiverStreams = receiver.createEncodedStreams();
  const {readable, writable} = receiverStreams;
  worker.postMessage({
    operation: 'decode',
    readable,
    writable,
  }, [readable, writable]);
}

function maybeSetCodecPreferences(trackEvent) {
  if (!'setCodecPreferences' in window.RTCRtpTransceiver.prototype) return;
  if (trackEvent.track.kind === 'audio' && preferredAudioCodecMimeType ) {
    const {codecs} = RTCRtpReceiver.getCapabilities('audio');
    const selectedCodecIndex = codecs.findIndex(c => c.mimeType === preferredAudioCodecMimeType);
    const selectedCodec = codecs[selectedCodecIndex];
    codecs.splice(selectedCodecIndex, 1);
    codecs.unshift(selectedCodec);
    trackEvent.transceiver.setCodecPreferences(codecs);
  } else if (trackEvent.track.kind === 'video' && preferredVideoCodecMimeType) {
    const {codecs} = RTCRtpReceiver.getCapabilities('video');
    const selectedCodecIndex = codecs.findIndex(c => c.mimeType === preferredVideoCodecMimeType);
    const selectedCodec = codecs[selectedCodecIndex];
    codecs.splice(selectedCodecIndex, 1);
    codecs.unshift(selectedCodec);
    trackEvent.transceiver.setCodecPreferences(codecs);
  }
}

function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');

  startToEnd = new VideoPipe(localStream, true, false, e => {
    // setupReceiverTransform(e.receiver);
    maybeSetCodecPreferences(e);
    gotRemoteStream(e.streams[0]);
  });
  startToEnd.pc1.getSenders().forEach(setupSenderTransform);
  startToEnd.negotiate();

  console.log('Video pipes created');
}

function hangup() {
  console.log('Ending call');
  // startToMiddle.close();
  startToEnd.close();
  hangupButton.disabled = true;
  callButton.disabled = false;
}

function setVideoStream(event) {
  console.log('Files: ' + videoFile.files.length);
  // eslint-disable-next-line guard-for-in
  for (let i = 0; i < videoFile.files.length; ++i) {
    const fr = new FileReader();
    fr.onload = () => {
      worker.postMessage({
        operation: 'setVideoStream',
        frame: fr.result,
      });
    };
    fr.readAsArrayBuffer(videoFile.files[i]);
  }
}

function downloadArrayBuffersAsFile(arrayBuffers, fileName) {
  // Create a Blob from the ArrayBuffer
  const blob = new Blob(arrayBuffers);

  // Create a download link
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;

  // Append the link to the document
  document.body.appendChild(link);

  // Trigger a click on the link to start the download
  link.click();

  // Remove the link from the document
  document.body.removeChild(link);
}
