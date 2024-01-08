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

let oldFrames = [];
let downloaded = false;
function encodeFunction(encodedFrame, controller) {
  if (encodedFrame instanceof RTCEncodedAudioFrame) {
    console.log('Got audio frame');
    controller.enqueue(encodedFrame);
    return;
  }

  // // downloads the first 100 encoded framesy
  // oldFrames.push(encodedFrame.data);
  // if (oldFrames.length >= 100) {
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

  if (storedFrames.length !== 0) {
    const frameObject = storedFrames[frameIndex % storedFrames.length];
    const newData = frameObject.frame;

    encodedFrame.data = newData;

    frameIndex += 1;
  }

  // console.log('Replaced frame', encodedFrame.data);
  // Send it to the output stream.
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
    readable
        .pipeTo(writable);
  }
}

// Handler for messages, including transferable streams.
onmessage = (event) => {
  if (event.data.operation === 'encode' || event.data.operation === 'decode') {
    return handleTransform(event.data.operation, event.data.readable, event.data.writable);
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