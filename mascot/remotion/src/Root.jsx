import React from 'react';
import {Composition} from 'remotion';
import {PactaSpin} from './PactaSpin.jsx';

const FPS = 30;
const LEAD_IN_FRAMES = FPS;
const SPIN_FRAMES = Math.ceil(1.48 * FPS);
const IDLE_OUT_FRAMES = 5 * FPS;

export const RemotionRoot = () => (
  <>
    <Composition
      id="PactaSpin"
      component={PactaSpin}
      durationInFrames={LEAD_IN_FRAMES + SPIN_FRAMES + IDLE_OUT_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{spinAtFrame: LEAD_IN_FRAMES, backgroundColor: 'transparent'}}
    />
    <Composition
      id="PactaSpinWhite"
      component={PactaSpin}
      durationInFrames={LEAD_IN_FRAMES + SPIN_FRAMES + IDLE_OUT_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{spinAtFrame: LEAD_IN_FRAMES, backgroundColor: '#ffffff'}}
    />
  </>
);
