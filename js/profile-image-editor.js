// Zuschnitt für eigene Profilbilder: quadratischer Ausschnitt mit Zoom und Verschieben.
// Gespeichert werden höchstens 600 × 600 Pixel als WebP und ein Vorschaubild bis 64 × 64 Pixel;
// kleinere Ausschnitte werden nicht hochskaliert.
(function () {
  'use strict';
  const PROFILE_SIZE = 600;
  const THUMB_SIZE = 64;
  const MAX_ZOOM = 4;

  // Liefert den quadratischen Ausschnitt in Originalpixeln. Der Mittelpunkt wird so begrenzt,
  // dass der Ausschnitt das Bild nie verlässt.
  function getCrop(sourceWidth, sourceHeight, zoom, centerX, centerY) {
    const safeZoom = Math.min(MAX_ZOOM, Math.max(1, Number(zoom) || 1));
    const side = Math.min(sourceWidth, sourceHeight) / safeZoom;
    const half = side / 2;
    const x = Math.min(sourceWidth - half, Math.max(half, Number.isFinite(centerX) ? centerX : sourceWidth / 2));
    const y = Math.min(sourceHeight - half, Math.max(half, Number.isFinite(centerY) ? centerY : sourceHeight / 2));
    return { zoom: safeZoom, side, centerX: x, centerY: y, left: x - half, top: y - half };
  }

  function getOutputSize(cropSide, maxSize) {
    return Math.max(1, Math.min(maxSize, Math.floor(cropSide)));
  }

  const api = { getCrop, getOutputSize, PROFILE_SIZE, THUMB_SIZE };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let dialog = null;

  function createDialog() {
    const element = document.createElement('dialog');
    element.className = 'dialog profile-image-editor';
    element.id = 'profile-image-editor';
    element.setAttribute('aria-labelledby', 'profile-image-editor-title');
    element.innerHTML = `
      <button class="secondary-button modal-close-button" type="button" data-profile-image-editor-cancel aria-label="Zuschnitt schließen"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg></button>
      <div class="dialog-card">
        <div class="eyebrow">Konto</div>
        <h2 id="profile-image-editor-title">Profilbild zuschneiden</h2>
        <p class="dialog-copy">Verschiebe das Bild und zoome, bis der Ausschnitt passt.</p>
        <div class="profile-image-editor-frame" data-profile-image-editor-frame>
          <canvas data-profile-image-editor-canvas aria-label="Vorschau des Ausschnitts" role="img"></canvas>
        </div>
        <label class="profile-image-editor-zoom">
          <span>Zoom</span>
          <input type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" data-profile-image-editor-zoom>
        </label>
        <div class="profile-image-editor-actions">
          <button class="secondary-button" type="button" data-profile-image-editor-cancel>Abbrechen</button>
          <button class="primary-button" type="button" data-profile-image-editor-save>Speichern</button>
        </div>
      </div>`;
    document.body.append(element);
    return element;
  }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        // Ältere Browser kennen die Option nicht; das Bildelement richtet EXIF-Bilder selbst aus.
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const sourceSize = source => ({
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height
  });

  function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  async function renderOutput(source, crop, size, type) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, crop.left, crop.top, crop.side, crop.side, 0, 0, size, size);
    const blob = await canvasToBlob(canvas, type, 0.85);
    // Browser ohne WebP-Ausgabe liefern PNG; dann wird stattdessen JPEG gespeichert.
    if (blob && blob.type === type) return blob;
    return canvasToBlob(canvas, 'image/jpeg', 0.85);
  }

  // Öffnet den Zuschnitt und liefert { profile, thumb } als Blobs oder null bei Abbruch.
  async function open(file) {
    const source = await loadBitmap(file);
    const { width, height } = sourceSize(source);
    if (!width || !height) throw new Error('Das Bild konnte nicht gelesen werden.');

    dialog ||= createDialog();
    const frame = dialog.querySelector('[data-profile-image-editor-frame]');
    const canvas = dialog.querySelector('[data-profile-image-editor-canvas]');
    const zoomInput = dialog.querySelector('[data-profile-image-editor-zoom]');
    const saveButton = dialog.querySelector('[data-profile-image-editor-save]');
    const context = canvas.getContext('2d');
    let crop = getCrop(width, height, 1);
    const pointers = new Map();
    let pinchDistance = 0;

    function draw() {
      const size = Math.round(frame.clientWidth * (window.devicePixelRatio || 1)) || 320;
      if (canvas.width !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, size, size);
      context.drawImage(source, crop.left, crop.top, crop.side, crop.side, 0, 0, size, size);
    }

    function update(zoom, centerX, centerY) {
      crop = getCrop(width, height, zoom, centerX, centerY);
      zoomInput.value = String(crop.zoom);
      draw();
    }

    // Bildschirmpixel im Rahmen in Originalpixel umrechnen.
    const sourcePixelsPerScreenPixel = () => crop.side / (frame.clientWidth || 1);

    function zoomAround(nextZoom, screenX, screenY) {
      const rect = frame.getBoundingClientRect();
      const ratio = sourcePixelsPerScreenPixel();
      const anchorX = crop.left + (screenX - rect.left) * ratio;
      const anchorY = crop.top + (screenY - rect.top) * ratio;
      const nextSide = Math.min(width, height) / Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      const scale = nextSide / crop.side;
      update(nextZoom, anchorX + (crop.centerX - anchorX) * scale, anchorY + (crop.centerY - anchorY) * scale);
    }

    const pointerCenter = () => {
      const points = [...pointers.values()];
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0
      };
    };

    const onPointerDown = event => {
      frame.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinchDistance = pointerCenter().distance;
    };
    const onPointerMove = event => {
      if (!pointers.has(event.pointerId)) return;
      const before = pointerCenter();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = pointerCenter();
      const ratio = sourcePixelsPerScreenPixel();
      update(crop.zoom, crop.centerX - (after.x - before.x) * ratio, crop.centerY - (after.y - before.y) * ratio);
      if (pointers.size > 1 && pinchDistance > 0 && after.distance > 0) {
        zoomAround(crop.zoom * (after.distance / pinchDistance), after.x, after.y);
        pinchDistance = after.distance;
      }
    };
    const onPointerUp = event => {
      pointers.delete(event.pointerId);
      pinchDistance = pointerCenter().distance || 0;
    };
    const onWheel = event => {
      event.preventDefault();
      zoomAround(crop.zoom * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
    };
    const onZoomInput = () => update(Number(zoomInput.value), crop.centerX, crop.centerY);

    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('pointercancel', onPointerUp);
    frame.addEventListener('wheel', onWheel, { passive: false });
    zoomInput.addEventListener('input', onZoomInput);
    window.addEventListener('resize', draw);

    saveButton.disabled = false;
    saveButton.textContent = 'Speichern';
    if (!dialog.open) dialog.showModal();
    update(1);

    return new Promise(resolve => {
      const finish = result => {
        frame.removeEventListener('pointerdown', onPointerDown);
        frame.removeEventListener('pointermove', onPointerMove);
        frame.removeEventListener('pointerup', onPointerUp);
        frame.removeEventListener('pointercancel', onPointerUp);
        frame.removeEventListener('wheel', onWheel);
        zoomInput.removeEventListener('input', onZoomInput);
        window.removeEventListener('resize', draw);
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('cancel', onCancel);
        if (dialog.open) dialog.close();
        source.close?.();
        resolve(result);
      };
      const onCancel = event => {
        event.preventDefault();
        finish(null);
      };
      const onClick = async event => {
        if (event.target.closest('[data-profile-image-editor-cancel]')) {
          finish(null);
          return;
        }
        if (!event.target.closest('[data-profile-image-editor-save]')) return;
        saveButton.disabled = true;
        saveButton.textContent = 'Wird vorbereitet …';
        const profile = await renderOutput(source, crop, getOutputSize(crop.side, PROFILE_SIZE), 'image/webp');
        const thumb = await renderOutput(source, crop, getOutputSize(crop.side, THUMB_SIZE), 'image/jpeg');
        finish(profile && thumb ? { profile, thumb } : null);
      };
      dialog.addEventListener('click', onClick);
      dialog.addEventListener('cancel', onCancel);
    });
  }

  window.PadelProfileImageEditor = Object.freeze({ ...api, open });
}());
