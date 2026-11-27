(() => {
  const menus = '.site-nav, .auth-mode-toggle';
  const groups = `${menus}, .toggle:not(.toggle--sort), .live-mode-toggle`;
  const options = 'button, a[data-section]';
  const hover = matchMedia('(hover: hover)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const selections = new WeakMap();
  const duration = 288;
  const frequency = 31;
  const dampingRatio = 0.75;
  const decayRate = dampingRatio * frequency;
  const dampedFrequency = frequency * Math.sqrt(1 - dampingRatio ** 2);

  function finish(selection) {
    if (!selection.layer) return;
    selection.motion.animation.cancel();
    selection.layer.remove();
    selection.option.removeAttribute('data-moving-selection');
    selection.layer = null;
  }

  function optionBox(option) {
    const width = option.offsetWidth;
    const height = option.offsetHeight;
    return [option.offsetLeft + width / 2, option.offsetTop + height / 2, width, height];
  }

  function spring(from, target, initialVelocity, seconds) {
    const displacement = from - target;
    const amplitude = (initialVelocity + decayRate * displacement) / dampedFrequency;
    const angle = dampedFrequency * seconds;
    const decay = Math.exp(-decayRate * seconds);
    const wave = displacement * Math.cos(angle) + amplitude * Math.sin(angle);
    const slope = dampedFrequency * (-displacement * Math.sin(angle) + amplitude * Math.cos(angle));
    return { value: target + decay * wave, velocity: decay * (slope - decayRate * wave) };
  }

  function moveHighlight(layer, start, target) {
    const [x, y, width, height] = target;
    Object.assign(layer.style, {
      left: `${x - width / 2}px`, top: `${y - height / 2}px`,
      width: `${width}px`, height: `${height}px`
    });

    // Sample the spring into compositor keyframes. Retarget from the same
    // trajectory so a new click inherits both the position and the speed.
    const sample = time => target.map((value, index) =>
      spring(start[index].value, value, start[index].velocity, time / 1000));
    const frames = Array.from({ length: 72 }, (_, index) => {
      const [centerX, centerY, sizeX, sizeY] = sample(index * duration / 72);
      // Stretch along the direction of travel and relax as the capsule settles.
      const stretchX = 1 + 0.22 * Math.tanh(centerX.velocity / 1100) ** 2;
      const stretchY = 1 + 0.22 * Math.tanh(centerY.velocity / 1100) ** 2;
      const scaleX = Math.max(1, sizeX.value) / width * stretchX / Math.sqrt(stretchY);
      const scaleY = Math.max(1, sizeY.value) / height * stretchY / Math.sqrt(stretchX);
      return { transform: `translate(${centerX.value - x}px, ${centerY.value - y}px) scale(${scaleX}, ${scaleY})` };
    });
    frames.push({ transform: 'translate(0px, 0px) scale(1, 1)' });
    const animation = layer.animate(frames, { duration });
    return { animation, current: () => sample(Number(animation.currentTime) || 0) };
  }

  function update(group) {
    const buttons = [...group.children].filter(child => child.matches(options));
    const active = buttons.filter(button => button.matches('.active, [aria-pressed="true"]'));
    const option = active.length === 1 ? active[0] : null;
    const previous = selections.get(group);
    if (previous?.option === option) return;

    const selection = { option, layer: null };
    selections.set(group, selection);
    const current = previous?.layer?.isConnected ? previous.motion.current() : null;
    if (previous) finish(previous);

    const lastOption = previous?.option;
    if (!option || !lastOption || reducedMotion.matches || !option.getClientRects().length) return;
    // The live switcher redraws its buttons when fresh scores arrive.
    const fromOption = group.contains(lastOption) ? lastOption
      : buttons.find(button => button.textContent.trim() === lastOption.textContent.trim());
    if (!current && (!fromOption || fromOption === option || !fromOption.getClientRects().length)) return;

    const { backgroundColor, borderRadius, boxShadow } = getComputedStyle(option);
    const layer = document.createElement('span');
    layer.className = 'selection-highlight';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { backgroundColor, borderRadius, boxShadow });
    group.prepend(layer);

    const from = current || optionBox(fromOption).map(value => ({ value, velocity: 0 }));
    const to = optionBox(option);
    if (to[2] === 0 || to[3] === 0 || from.every(({ value, velocity }, index) => value === to[index] && velocity === 0)) {
      layer.remove();
      return;
    }

    const keepOutline = hover.matches && group.matches(menus) && option.matches(':hover');
    selection.layer = layer;
    option.setAttribute('data-moving-selection', keepOutline ? 'hover' : '');
    selection.motion = moveHighlight(layer, from, to);
    selection.motion.animation.onfinish = () => finish(selection);
  }

  document.querySelectorAll(groups).forEach(update);
  new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      const { target } = record;
      if (target.matches?.(groups)) changed.add(target);
      if (target.matches?.(options) && target.parentElement?.matches(groups)) changed.add(target.parentElement);
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(groups)) changed.add(node);
        node.querySelectorAll(groups).forEach(group => changed.add(group));
      }
    }
    changed.forEach(group => {
      if (group.isConnected) update(group);
    });
  }).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed']
  });

  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    document.querySelectorAll('.selection-highlight').forEach(layer => finish(selections.get(layer.parentElement)));
  });
})();
