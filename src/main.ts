import { Game } from './game/game';
import { bindBootProgress } from './boot-progress';
import { homeBackdropDay, loadPlayerSlot, rememberLastPlayed, rememberPlayerSlot } from './progress';
import { isPlayerSlotId } from './roster';
import { bindAvatar, bindHome, bindPlay, initShell, playUrl, setMode, showResult, wantsAutoPlay } from './shell';
import { bgm, sfx } from './audio';

initShell();
setMode('loading');
const bootProgress = bindBootProgress();

const auto = wantsAutoPlay();
const bootDay = auto?.day ?? homeBackdropDay();
bgm.play(auto?.day ?? 'home');
sfx.unlock();
const qPlayer = new URLSearchParams(location.search).get('player');
const bootPlayer = auto?.player ?? (isPlayerSlotId(qPlayer) ? qPlayer : loadPlayerSlot());
const game = new Game();
game.onSettled = (kind, info) => showResult(kind, info.day, info.sub, game.playerSlot);

bindPlay((day, player) => {
  rememberPlayerSlot(player);
  rememberLastPlayed(day);
  bgm.play(day);
  if (game.day === day && game.playerSlot === player) {
    game.beginPlay();
    setMode('play');
    return;
  }
  location.assign(playUrl(day, player));
});

bindHome(() => game.enterMenu());
bindAvatar({
  show: (id) => game.enterAvatarPick(id),
  hide: () => game.exitAvatarPick(),
  select: (id) => game.selectAvatar(id),
});

const loadingSub = document.querySelector('#loading .sub') as HTMLElement | null;
if (loadingSub) loadingSub.textContent = auto ? '正在进入办公室…' : '正在准备场景…';

game
  .start(document.getElementById('app')!, bootDay, { menu: !auto, playerSlot: bootPlayer, onProgress: bootProgress })
  .then(() => {
    if (auto) {
      rememberPlayerSlot(auto.player);
      rememberLastPlayed(auto.day);
      setMode('play');
    } else {
      setMode('home');
      const preview = new URLSearchParams(location.search).get('result');
      if (preview === 'lost' || preview === 'won' || preview === 'finale') {
        showResult(
          preview === 'lost' ? 'lost' : 'won',
          preview === 'finale' ? 'friday' : preview === 'won' ? 'monday' : bootDay,
          preview === 'lost'
            ? '任务塞到了 24:00<br>下次试着把人群引开、用冲刺撞穿薄弱处'
            : '逃亡用时 01:08<br>最终下班时间 18:24',
          bootPlayer
        );
      }
    }
  })
  .catch((err) => {
    setMode('loading');
    const el = document.querySelector('#loading .sub')!;
    el.textContent = '启动失败：' + bootError(err);
    console.error(err);
  });

function bootError(err: unknown) {
  if (err instanceof Event) {
    const t = err.target as { src?: string } | null;
    return t?.src || err.type || '资源加载失败';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
