import Phaser from 'phaser';
import { getStage } from './three/stage';
import { getBattlefield } from './three/battlefield';
import { loadCardData } from './customCards';

// Custom cards live in public/card-data.json and must be applied before any scene module
// loads: meta.ts validates the saved deck against CARDS the moment it is imported.
await loadCardData();

const [{ BootScene }, { MenuScene }, { BattleScene }, { TalentScene }, { DeckScene }] = await Promise.all([
  import('./scenes/BootScene'),
  import('./scenes/MenuScene'),
  import('./scenes/BattleScene'),
  import('./scenes/TalentScene'),
  import('./scenes/DeckScene'),
]);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 540,
  height: 960,
  backgroundColor: '#1a120c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, BattleScene, TalentScene, DeckScene],
});

// 3D models are optional: if WebGL is unavailable the round portraits are used instead.
game.events.once(Phaser.Core.Events.READY, () => {
  try {
    getStage().attach(game);
  } catch (err) {
    console.warn('3D models disabled:', err);
  }
  try {
    getBattlefield().attach(game);
  } catch (err) {
    console.warn('3D battlefield disabled:', err);
  }
});

if (import.meta.env.DEV) (window as unknown as { stage: unknown }).stage = getStage;
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
