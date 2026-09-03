import { Game } from './game/game';
import { homeBackdropDay, rememberLastPlayed } from './progress';
import { bindHome, bindPlay, initShell, playUrl, setMode, showResult, wantsAutoPlay } from './shell';

initShell();
setMode('loading');

const auto = wantsAutoPlay();
const bootDay = auto ?? homeBackdropDay();
const game = new Game();
game.onSettled = (kind, info) => showResult(kind, info.day, info.sub);

bindPlay((day) => {
  rememberLastPlayed(day);
  if (game.day === day) {
    game.beginPlay();
    setMode('play');
    return;
  }
  location.assign(playUrl(day));
});

bindHome(() => game.enterMenu());

const loadingSub = document.querySelector('#loading .sub') as HTMLElement | null;
if (loadingSub) loadingSub.textContent = auto ? '正在进入办公室…' : '正在准备场景…';

game
  .start(document.getElementById('app')!, bootDay, { menu: !auto })
  .then(() => {
    if (auto) {
      rememberLastPlayed(auto);
      setMode('play');
    } else {
      setMode('home');
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
