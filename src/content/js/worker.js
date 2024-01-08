/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/*
 * This is a worker doing the encode/decode transformations to add end-to-end
 * encryption to a WebRTC PeerConnection using the Insertable Streams API.
 */

'use strict';
let currentCryptoKey;
let useCryptoOffset = true;
let currentKeyIdentifier = 0;

let storedFrames = [];
let frameIndex = 0;

// If using crypto offset (controlled by a checkbox):
// Do not encrypt the first couple of bytes of the payload. This allows
// a middle to determine video keyframes or the opus mode being used.
// For VP8 this is the content described in
//   https://tools.ietf.org/html/rfc6386#section-9.1
// which is 10 bytes for key frames and 3 bytes for delta frames.
// For opus (where encodedFrame.type is not set) this is the TOC byte from
//   https://tools.ietf.org/html/rfc6716#section-3.1
// TODO: make this work for other codecs.
//
// It makes the (encrypted) video and audio much more fun to watch and listen to
// as the decoder does not immediately throw a fatal error.
const frameTypeToCryptoOffset = {
  key: 10,
  delta: 3,
  undefined: 1,
};

function dump(encodedFrame, direction, max = 16) {
  const data = new Uint8Array(encodedFrame.data);
  let bytes = '';
  for (let j = 0; j < data.length && j < max; j++) {
    bytes += (data[j] < 16 ? '0' : '') + data[j].toString(16) + ' ';
  }
  const metadata = encodedFrame.getMetadata();
  console.log(performance.now().toFixed(2), direction, bytes.trim(),
      'len=' + encodedFrame.data.byteLength,
      'type=' + (encodedFrame.type || 'audio'),
      'ts=' + encodedFrame.timestamp,
      'ssrc=' + metadata.synchronizationSource,
      'pt=' + (metadata.payloadType || '(unknown)'),
      'mimeType=' + (metadata.mimeType || '(unknown)'),
  );
}

let count = 0;
let oldFrames = [];
let downloaded = false;
function encodeFunction(encodedFrame, controller) {
  if (encodedFrame instanceof RTCEncodedAudioFrame) {
    console.log('Got audio frame');
    controller.enqueue(encodedFrame);
    return;
  }

  oldFrames.push(encodedFrame.data);
  // if (oldFrames.length >= 100) {
  //   // downloads the first 100 encoded frames
  //   if (!downloaded) {
  //     downloaded = true;
  //     self.postMessage({
  //       operation: 'download',
  //       data: oldFrames,
  //     });
  //   }

  //   encodedFrame.data = oldFrames.shift();
  // }


  // controller.enqueue(encodedFrame);
  // return;

  // const view = new DataView(encodedFrame.data);

  // console.log(encodedFrame.getMetadata());
  // console.log('frame', arrayBufferToBase64(encodedFrame.data));
  // console.log('Actual frame', encodedFrame);

  // Replace the frame's data with the new buffer.
  // if (count < 100) {
  //   encodedFrame.data = base64ToArrayBuffer('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');
  // } else {
  //   encodedFrame.data = base64ToArrayBuffer('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');
  // }

  // if (count++ > 200) {
  //   count = 0;
  // }

  if (storedFrames.length !== 0) {
    const frameObject = storedFrames[frameIndex % storedFrames.length];
    const newData = frameObject.frame;

    encodedFrame.data = newData;

    // const metadata = encodedFrame.getMetadata();
    // // console.log('oldMetadata', JSON.parse(JSON.stringify(metadata)));

    // metadata.rtpTimestamp = 1000000/29.97 * frameIndex;
    // metadata.frameId = frameIndex;

    // if (frameObject.isKeyframe) {
    //   console.log('Keyframe');
    //   metadata.dependencies = [];
    // } else {
    //   metadata.dependencies = [frameIndex - 1];
    // }

    // // console.log('newMetadata', metadata);

    // encodedFrame.setMetadata(metadata);

    frameIndex += 1;
  }

  // console.log('Replaced frame', encodedFrame.data);
  // Send it to the output stream.
  controller.enqueue(encodedFrame);
}

function decodeFunction(encodedFrame, controller) {
  // Reconstruct the original frame.
  const view = new DataView(encodedFrame.data);

  // Ignore the last 4 bytes
  const newData = new ArrayBuffer(encodedFrame.data.byteLength);
  const newView = new DataView(newData);

  // Negate all bits in the incoming frame, ignoring the
  // last 4 bytes
  for (let i = 0; i < encodedFrame.data.byteLength; ++i) newView.setInt8(i, ~view.getInt8(i));

  // encodedFrame.data = newData;
  controller.enqueue(encodedFrame);
}

function handleTransform(operation, readable, writable) {
  if (operation === 'encode') {
    const transformStream = new TransformStream({
      transform: encodeFunction,
    });
    readable
        .pipeThrough(transformStream)
        .pipeTo(writable);
  } else if (operation === 'decode') {
    const transformStream = new TransformStream({
      transform: decodeFunction,
    });
    readable
        .pipeThrough(transformStream)
        .pipeTo(writable);
  }
}

// Handler for messages, including transferable streams.
onmessage = (event) => {
  if (event.data.operation === 'encode' || event.data.operation === 'decode') {
    return handleTransform(event.data.operation, event.data.readable, event.data.writable);
  }
  if (event.data.operation === 'setCryptoKey') {
    if (event.data.currentCryptoKey !== currentCryptoKey) {
      currentKeyIdentifier++;
    }
    currentCryptoKey = event.data.currentCryptoKey;
    useCryptoOffset = event.data.useCryptoOffset;

    return;
  }

  if (event.data.operation === 'setVideoStream') {
    parseH264Stream(event.data.frame);

    return;
  }
};

// Handler for RTCRtpScriptTransforms.
if (self.RTCTransformEvent) {
  self.onrtctransform = (event) => {
    const transformer = event.transformer;
    handleTransform(transformer.options.operation, transformer.readable, transformer.writable);
  };
}

function arrayBufferToBase64( buffer ) {
  let binary = '';
  const bytes = new Uint8Array( buffer );
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode( bytes[i] );
  }
  return btoa( binary );
}

function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array( len );
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function parseH264Stream(stream) {
  storedFrames = [];

  const view = new DataView(stream);

  let lastStart = 0;
  let slice = false;
  let zeroCounter = 0;
  let isKeyframe = false;

  for (let i = 0; i < stream.byteLength; ++i) {
    if (view.getUint8(i) == 0) {
      zeroCounter++;
      continue;
    }

    if ((zeroCounter == 2 || zeroCounter == 3) && view.getInt8(i) == 1) {
      // found NALU
      if (slice) {
        const frameObject = {
          isKeyframe: isKeyframe,
          frame: stream.slice(lastStart, i - zeroCounter),
        };
        storedFrames.push(frameObject);
        slice = false;
        lastStart = i - zeroCounter;
      }

      const type = view.getInt8(i + 1);
      const ref_idc = (type >> 5) & 0x3;
      const unit_type = type & 0x1f;
      console.log('type (hex)', type.toString(16));
      console.log('idc', ref_idc);
      console.log('unit_type', unit_type);

      // not sure what happens when type is 2,3,4
      if (unit_type == 5) {
        // found VCL NALU
        slice = true;
        isKeyframe = true;
      } else if (unit_type == 1) {
        // found VCL NALU
        slice = true;
        isKeyframe = false;
      }
    }

    zeroCounter = 0;
  }

  console.log('Split NALU stream into frames: ', storedFrames.length);
}