import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const SOURCE_WIDTH = 1672;
const SOURCE_HEIGHT = 941;

// Each crop includes the card's baked shadow and a narrow strip of the original
// warm-white canvas. Together the five crops reconstruct the generated artwork.
const TILES = [
  {key: 'freight', x: 24, y: 25, width: 895, height: 448},
  {key: 'move', x: 915, y: 25, width: 730, height: 448},
  {key: 'build', x: 24, y: 468, width: 582, height: 450},
  {key: 'source', x: 598, y: 468, width: 502, height: 450},
  {key: 'care', x: 1086, y: 468, width: 559, height: 450},
];

const ENTER_FRAMES = 30;
const STAGGER_FRAMES = 15;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const Tile = ({tile, index, reducedMotion}) => {
  const frame = useCurrentFrame();
  const delay = reducedMotion ? index * 2 : index * STAGGER_FRAMES;
  const duration = reducedMotion ? 8 : ENTER_FRAMES;
  const progress = interpolate(frame, [delay, delay + duration], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(progress, [0, 0.18, 1], [0, 0.72, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = reducedMotion ? 0 : interpolate(progress, [0, 1], [18, 0]);
  const scale = reducedMotion ? 1 : interpolate(progress, [0, 1], [0.985, 1]);

  return (
    <div
      style={{
        position: 'absolute',
        left: tile.x,
        top: tile.y,
        width: tile.width,
        height: tile.height,
        overflow: 'hidden',
        opacity,
        transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
        transformOrigin: '50% 50%',
        willChange: 'transform, opacity',
      }}
    >
      <Img
        src={staticFile('pacta-multi-market-bento-v2.png')}
        style={{
          position: 'absolute',
          left: -tile.x,
          top: -tile.y,
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          maxWidth: 'none',
        }}
      />
    </div>
  );
};

export const PactaMarkets = ({reducedMotion = false}) => {
  const {width, height} = useVideoConfig();
  const scale = Math.min(width / SOURCE_WIDTH, height / SOURCE_HEIGHT);
  const scaledWidth = SOURCE_WIDTH * scale;
  const scaledHeight = SOURCE_HEIGHT * scale;

  return (
    <AbsoluteFill style={{backgroundColor: '#faf9f7', overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          left: (width - scaledWidth) / 2,
          top: (height - scaledHeight) / 2,
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {TILES.map((tile, index) => (
          <Tile key={tile.key} tile={tile} index={index} reducedMotion={reducedMotion} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
