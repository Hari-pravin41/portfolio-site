(function () {
  function widen() {
    document.querySelectorAll('#root *').forEach(function (el) {
      var mw = parseFloat(getComputedStyle(el).maxWidth);
      if (!isNaN(mw) && mw >= 900 && mw <= 1600) {
        el.style.maxWidth = 'none';
        el.style.paddingLeft = 'clamp(16px, 3vw, 56px)';
        el.style.paddingRight = 'clamp(16px, 3vw, 56px)';
      }
    });
  }

  var timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(widen, 100);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
})();