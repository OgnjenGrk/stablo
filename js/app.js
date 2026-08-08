(function () {
  const byId = new Map(PEOPLE.map(p => [p.id, p]));
  const layout = LAYOUT.buildLayout(PEOPLE);

  const svg = document.getElementById("tree-svg");
  const nodesLayer = document.getElementById("tree-nodes");
  const canvas = document.getElementById("tree-canvas");
  const viewport = document.getElementById("tree-viewport");

  const PAD = 90; // мора да прати padding из CSS-а на #tree-canvas
  svg.setAttribute("width", layout.totalWidth);
  svg.setAttribute("height", layout.totalHeight);
  svg.setAttribute("viewBox", `0 0 ${layout.totalWidth} ${layout.totalHeight}`);
  nodesLayer.style.width = layout.totalWidth + "px";
  nodesLayer.style.height = layout.totalHeight + "px";

  // ---------- боја аватара по имену (стабилна, из ограничене палете) ----------
  const AVATAR_TONES = ["t-gold", "t-sage", "t-wine"];
  function toneFor(id) {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_TONES[h % AVATAR_TONES.length];
  }
  function initials(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  }
  function formatYears(p) {
    if (p.death) return `${p.birth} — ${p.death}`;
    if (p.birth) return `р. ${p.birth}`;
    return "";
  }

  // ---------- цртање грана (родитељ → дете) ----------
  const nsPath = (d, cls) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    el.setAttribute("class", cls);
    return el;
  };
  layout.parentChildPaths.forEach(p => svg.appendChild(nsPath(p.d, "branch-path")));
  layout.marriageLines.forEach(l => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
    el.setAttribute("x1", l.x1); el.setAttribute("y1", l.y1);
    el.setAttribute("x2", l.x2); el.setAttribute("y2", l.y2);
    el.setAttribute("class", "marriage-line");
    svg.appendChild(el);
  });

  // ---------- цртање особа ----------
  layout.nodes.forEach(n => {
    const p = n.person;
    const el = document.createElement("button");
    el.className = "person-node" + (p.death ? "" : " living");
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    el.setAttribute("aria-label", `${p.name}, отвори биографију`);

    const frame = document.createElement("div");
    frame.className = "frame";
    if (p.photo) {
      const img = document.createElement("img");
      img.src = p.photo;
      img.alt = p.name;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
      frame.appendChild(img);
    } else {
      frame.textContent = initials(p.name);
      frame.classList.add(toneFor(p.id));
    }

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name;

    const years = document.createElement("div");
    years.className = "years";
    years.textContent = formatYears(p);

    el.appendChild(frame);
    el.appendChild(name);
    el.appendChild(years);
    el.addEventListener("click", () => openPanel(p.id));
    nodesLayer.appendChild(el);
  });

  // додатне тонске боје за аватар-иницијале (уклапа се у палету)
  const style = document.createElement("style");
  style.textContent = `
    .t-gold { color: var(--gold); }
    .t-sage { color: var(--sage); }
    .t-wine { color: #C97F7F; }
  `;
  document.head.appendChild(style);

  // ---------- панел са биографијом ----------
  const panel = document.getElementById("person-panel");
  const backdrop = document.getElementById("panel-backdrop");
  const panelPhoto = document.getElementById("panel-photo");
  const panelYears = document.getElementById("panel-years");
  const panelName = document.getElementById("panel-name");
  const panelBio = document.getElementById("panel-bio");
  const panelGallery = document.getElementById("panel-gallery");

  function openPanel(id) {
    const p = byId.get(id);
    if (!p) return;

    panelPhoto.innerHTML = "";
    if (p.photo) {
      const img = document.createElement("img");
      img.src = p.photo;
      img.alt = p.name;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
      panelPhoto.appendChild(img);
    } else {
      panelPhoto.textContent = initials(p.name);
    }

    const maidenTxt = p.maiden ? ` (рођ. ${p.maiden})` : "";
    panelName.textContent = p.name + maidenTxt;
    panelYears.textContent = formatYears(p);
    panelBio.textContent = p.bio || "Биографија још није унета.";

    panelGallery.innerHTML = "";
    if (p.gallery && p.gallery.length) {
      p.gallery.forEach(src => {
        const img = document.createElement("img");
        img.src = src;
        img.alt = p.name;
        img.addEventListener("click", () => openLightbox(src));
        panelGallery.appendChild(img);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent = "Још нема додатих слика. Убаци фотографије у images/ и додај путање у gallery поље.";
      panelGallery.appendChild(empty);
    }

    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    backdrop.classList.add("open");
  }

  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    backdrop.classList.remove("open");
  }
  document.getElementById("panel-close").addEventListener("click", closePanel);
  backdrop.addEventListener("click", closePanel);
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closePanel(); closeLightbox(); } });

  // ---------- лајтбокс ----------
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  }
  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
  }
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLightbox(); });

  // ---------- зум ----------
  let scale = 1;
  const zoomLabel = document.getElementById("zoom-label");
  function applyZoom() {
    canvas.style.transform = `scale(${scale})`;
    zoomLabel.textContent = Math.round(scale * 100) + "%";
  }
  document.getElementById("zoom-in").addEventListener("click", () => { scale = Math.min(1.6, scale + 0.1); applyZoom(); });
  document.getElementById("zoom-out").addEventListener("click", () => { scale = Math.max(0.4, scale - 0.1); applyZoom(); });

  function centerHorizontally(behavior) {
    viewport.scrollTo({
      left: (layout.totalWidth + PAD * 2) / 2 - viewport.clientWidth / 2,
      top: 0,
      behavior: behavior || "auto"
    });
  }

  document.getElementById("zoom-reset").addEventListener("click", () => {
    scale = 1;
    applyZoom();
    centerHorizontally("smooth");
  });

  // ---------- превлачење мишем (pan) ----------
  let dragging = false, startX, startY, scrollLeft, scrollTop;
  viewport.addEventListener("mousedown", e => {
    if (e.target.closest(".person-node")) return;
    dragging = true;
    viewport.classList.add("grabbing");
    startX = e.pageX; startY = e.pageY;
    scrollLeft = viewport.scrollLeft; scrollTop = viewport.scrollTop;
  });
  window.addEventListener("mouseup", () => { dragging = false; viewport.classList.remove("grabbing"); });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    viewport.scrollLeft = scrollLeft - (e.pageX - startX);
    viewport.scrollTop = scrollTop - (e.pageY - startY);
  });

  // почетно центрирање на средину стабла — покушано неколико пута
  // (виду прегледача понекад треба тренутак да измери ширину viewport-а)
  requestAnimationFrame(() => {
    centerHorizontally();
    requestAnimationFrame(() => centerHorizontally());
  });
  window.addEventListener("load", () => centerHorizontally());

  // ---------- трагач (мини-преглед целог стабла) ----------
  const scrubberTrack = document.getElementById("scrubber-track");
  const scrubberThumb = document.getElementById("scrubber-thumb");

  function updateScrubber() {
    const trackW = scrubberTrack.clientWidth;
    const scrollW = viewport.scrollWidth;
    const clientW = viewport.clientWidth;
    if (scrollW <= clientW) {
      scrubberThumb.style.width = trackW + "px";
      scrubberThumb.style.left = "0px";
      return;
    }
    const thumbW = Math.max(24, trackW * (clientW / scrollW));
    const maxThumbLeft = trackW - thumbW;
    const scrollRatio = viewport.scrollLeft / (scrollW - clientW);
    scrubberThumb.style.width = thumbW + "px";
    scrubberThumb.style.left = (scrollRatio * maxThumbLeft) + "px";
  }

  function scrollFromScrubberX(clientX) {
    const trackRect = scrubberTrack.getBoundingClientRect();
    const thumbW = scrubberThumb.offsetWidth;
    const rawLeft = clientX - trackRect.left - thumbW / 2;
    const maxThumbLeft = trackRect.width - thumbW;
    const clampedLeft = Math.max(0, Math.min(maxThumbLeft, rawLeft));
    const ratio = maxThumbLeft > 0 ? clampedLeft / maxThumbLeft : 0;
    viewport.scrollLeft = ratio * (viewport.scrollWidth - viewport.clientWidth);
  }

  let scrubDragging = false;
  scrubberThumb.addEventListener("mousedown", e => {
    scrubDragging = true;
    scrubberThumb.classList.add("dragging");
    e.preventDefault();
  });
  scrubberTrack.addEventListener("mousedown", e => {
    if (e.target === scrubberThumb) return;
    scrollFromScrubberX(e.clientX);
    scrubDragging = true;
    scrubberThumb.classList.add("dragging");
  });
  window.addEventListener("mousemove", e => {
    if (!scrubDragging) return;
    scrollFromScrubberX(e.clientX);
  });
  window.addEventListener("mouseup", () => {
    scrubDragging = false;
    scrubberThumb.classList.remove("dragging");
  });

  // додирни екрани (мобилни)
  scrubberThumb.addEventListener("touchstart", () => { scrubDragging = true; }, { passive: true });
  scrubberTrack.addEventListener("touchstart", e => {
    scrollFromScrubberX(e.touches[0].clientX);
    scrubDragging = true;
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (!scrubDragging || !e.touches[0]) return;
    scrollFromScrubberX(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener("touchend", () => { scrubDragging = false; });

  viewport.addEventListener("scroll", updateScrubber);
  window.addEventListener("resize", updateScrubber);
  requestAnimationFrame(updateScrubber);
  window.addEventListener("load", () => setTimeout(updateScrubber, 50));

  // зум такође мења scrollWidth (превод се рачуна по трансформисаним
  // границама), па и он мора да освежи трагача
  const _applyZoomOrig = applyZoom;
  applyZoom = function () {
    _applyZoomOrig();
    requestAnimationFrame(updateScrubber);
  };

  // ---------- претрага и скок на особу ----------
  const searchInput = document.getElementById("person-search");
  const datalist = document.getElementById("person-datalist");
  const labelToId = new Map();

  PEOPLE
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "sr"))
    .forEach(p => {
      const maidenTxt = p.maiden ? ` (рођ. ${p.maiden})` : "";
      const yearsTxt = formatYears(p) ? ` — ${formatYears(p)}` : "";
      const label = `${p.name}${maidenTxt}${yearsTxt}`;
      labelToId.set(label, p.id);
      const opt = document.createElement("option");
      opt.value = label;
      datalist.appendChild(opt);
    });

  function jumpToPerson(id) {
    const target = Array.from(nodesLayer.children).find((node, i) => layout.nodes[i].person.id === id);
    if (!target) return;

    const vpRect = viewport.getBoundingClientRect();
    const elRect = target.getBoundingClientRect();
    const targetScrollLeft = viewport.scrollLeft + (elRect.left - vpRect.left) + elRect.width / 2 - viewport.clientWidth / 2;
    const targetScrollTop = viewport.scrollTop + (elRect.top - vpRect.top) + elRect.height / 2 - viewport.clientHeight / 2;
    viewport.scrollTo({ left: targetScrollLeft, top: targetScrollTop, behavior: "smooth" });

    target.classList.remove("jump-highlight");
    void target.offsetWidth; // ресетуј анимацију ако се понови на истом чвору
    target.classList.add("jump-highlight");
    setTimeout(() => target.classList.remove("jump-highlight"), 1500);
  }

  function resolveSearchId(query) {
    if (labelToId.has(query)) return labelToId.get(query);
    const q = query.trim().toLowerCase();
    if (!q) return null;
    for (const [label, id] of labelToId) {
      if (label.toLowerCase().startsWith(q)) return id;
    }
    return null;
  }

  function trySearchJump() {
    const id = resolveSearchId(searchInput.value);
    if (id) {
      jumpToPerson(id);
      searchInput.blur();
    }
  }
  searchInput.addEventListener("change", trySearchJump);
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") trySearchJump();
  });
})();
