// 巡航心跳 Worker：以可调周期向主线程 postMessage，驱动 tickCruise /
// tickAutoReview。用 Worker 驱动可绕过浏览器对后台页面的定时器节流
// （AN-045 同款方案）。onmessage 里装载回调，见 §8 装配代码。
let t = null;
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.cmd === "start") { if (t !== null) clearInterval(t); t = setInterval(() => self.postMessage(0), d.ms); }
  else if (d.cmd === "stop") { if (t !== null) clearInterval(t); t = null; }
};
