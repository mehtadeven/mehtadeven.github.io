// The 3D "forward pass": a neural network the camera flies through as you scroll.
// Station 0 is the hero network; stations 1-7 are the journey layers; station 8
// pulls back to show the whole path. Plain Three.js, no build step.
import * as THREE from "../vendor/three.module.min.js";

const COLORS = {
  bg: 0x0b0f1a,
  cyan: 0x22d3ee,
  violet: 0x7f77dd,
  violet2: 0xb4aef0,
  green: 0x34d399,
  pink: 0xf472b6,
  text: 0xe6edf3,
};
const canvas = document.getElementById("scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

if (!canvas || !webglAvailable()) {
  document.documentElement.classList.add("no-webgl");
} else {
  start().catch((error) => {
    console.warn("3D scene turned off:", error);
    document.documentElement.classList.add("no-webgl");
  });
}

// ---------------------------------------------------------------- helpers

// Small seeded random generator, so the scene looks the same on every visit.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

function glowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.16, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function start() {
  // Sprite labels are drawn with the site's mono font, so wait for it briefly.
  try {
    await Promise.race([
      document.fonts.load('500 64px "JetBrains Mono"'),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch { /* fall back to the system monospace font */ }

  const small = () => window.innerWidth < 900;
  const lowPower = small() || (navigator.hardwareConcurrency || 8) <= 4;
  const timeScale = reduceMotion ? 0 : 1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.setClearColor(COLORS.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.bg, 0.027);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

  const GLOW = glowTexture();
  const LABEL_SCALE = small() ? 1.05 : 1.45;
  const tmpColor = new THREE.Color();

  const glowPoints = (positions, { colors = null, color = COLORS.cyan, size = 0.5, opacity = 1 } = {}) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size,
      map: GLOW,
      color: colors ? 0xffffff : color,
      vertexColors: !!colors,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return new THREE.Points(geo, mat);
  };

  const lines = (positions, { colors = null, color = COLORS.violet, opacity = 0.2 } = {}) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      color: colors ? 0xffffff : color,
      vertexColors: !!colors,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.LineSegments(geo, mat);
  };

  // Text that always faces the camera.
  const label = (text, { height = 0.5, color = "#e6edf3", glow = "rgba(34,211,238,0.6)", box = false } = {}) => {
    const font = '500 64px "JetBrains Mono", ui-monospace, Consolas, monospace';
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    g.font = font;
    const pad = box ? 34 : 20;
    const w = Math.ceil(g.measureText(text).width) + pad * 2;
    const h = 64 + pad * 2;
    c.width = w;
    c.height = h;
    if (box) {
      g.fillStyle = "rgba(11,15,26,0.78)";
      g.strokeStyle = "rgba(127,119,221,0.75)";
      g.lineWidth = 3;
      g.beginPath();
      if (g.roundRect) g.roundRect(3, 3, w - 6, h - 6, 22);
      else g.rect(3, 3, w - 6, h - 6);
      g.fill();
      g.stroke();
    }
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = glow;
    g.shadowBlur = 20;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const H = height * LABEL_SCALE;
    sprite.scale.set((H * w) / h, H, 1);
    return sprite;
  };

  // ---------------------------------------------------------------- stations
  const GAP = 34;
  const P = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(5, 2, -GAP * 1),
    new THREE.Vector3(-4, -1, -GAP * 2),
    new THREE.Vector3(4, 1.5, -GAP * 3),
    new THREE.Vector3(-3, -1.5, -GAP * 4),
    new THREE.Vector3(5, 0.5, -GAP * 5),
    new THREE.Vector3(-2, 2, -GAP * 6),
    new THREE.Vector3(3, 0, -GAP * 7),
  ];
  const stations = [];
  const addStation = (index, build, distance) => {
    const group = new THREE.Group();
    group.position.copy(P[index]);
    scene.add(group);
    const station = { group, distance, labels: [], update: () => {} };
    build(station, group);
    stations[index] = station;
  };

  // 0 · Hero: a small multilayer perceptron with signals flowing forward.
  addStation(0, (st, g) => {
    const sizes = [5, 8, 10, 8, 3];
    const layerColors = [COLORS.cyan, COLORS.cyan, COLORS.violet2, COLORS.violet, COLORS.pink];
    const nodes = sizes.map((n, l) =>
      Array.from({ length: n }, (_, j) => new THREE.Vector3((l - 2) * 3.6, (j - (n - 1) / 2) * 1.15, Math.sin(j * 1.7 + l) * 1.3))
    );
    const pos = [], col = [];
    nodes.forEach((layer, l) => layer.forEach((p) => {
      pos.push(p.x, p.y, p.z);
      tmpColor.set(layerColors[l]);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }));
    g.add(glowPoints(pos, { colors: col, size: 1.15 }));

    const ePos = [], eCol = [];
    for (let l = 0; l < nodes.length - 1; l++) {
      const a = new THREE.Color(layerColors[l]), b = new THREE.Color(layerColors[l + 1]);
      for (const p of nodes[l]) for (const q of nodes[l + 1]) {
        ePos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        eCol.push(a.r, a.g, a.b, b.r, b.g, b.b);
      }
    }
    g.add(lines(ePos, { colors: eCol, opacity: 0.17 }));

    // Signals: each hops from a node in one layer to a node in the next.
    const rand = rng(7);
    const SIGNALS = 34;
    const sig = Array.from({ length: SIGNALS }, () => {
      const l = Math.floor(rand() * (sizes.length - 1));
      return { l, a: Math.floor(rand() * sizes[l]), b: Math.floor(rand() * sizes[l + 1]), u: rand(), speed: 0.55 + rand() * 0.7 };
    });
    const sigPts = glowPoints(new Array(SIGNALS * 3).fill(0), { color: 0xffffff, size: 0.55 });
    g.add(sigPts);
    const sp = sigPts.geometry.attributes.position;

    const ring = label("input → hidden layers → output", { height: 0.42, color: "#8b949e", glow: "rgba(0,0,0,0)" });
    ring.position.set(0, -7.4, 0);
    g.add(ring);

    st.update = (t, dt, active) => {
      g.rotation.y = Math.sin(t * 0.18) * 0.38 - 0.18;
      g.rotation.x = Math.sin(t * 0.13) * 0.08;
      sig.forEach((s, i) => {
        s.u += dt * s.speed;
        if (s.u >= 1) {
          s.u -= 1;
          s.l = s.l + 1 >= sizes.length - 1 ? 0 : s.l + 1;
          s.a = s.l === 0 ? Math.floor(rand() * sizes[0]) : s.b;
          if (s.l === 0) s.a = Math.floor(rand() * sizes[0]);
          s.b = Math.floor(rand() * sizes[s.l + 1]);
        }
        const p = nodes[s.l][Math.min(s.a, sizes[s.l] - 1)], q = nodes[s.l + 1][s.b];
        sp.setXYZ(i, lerp(p.x, q.x, s.u), lerp(p.y, q.y, s.u), lerp(p.z, q.z, s.u));
      });
      sp.needsUpdate = true;
      ring.material.opacity = active;
    };
  }, 15.5);

  // 1 · Hello, World: a lattice of structure.
  addStation(1, (st, g) => {
    const n = 4, s = 1.6, o = ((n - 1) * s) / 2;
    const pos = [], ePos = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      const p = [x * s - o, y * s - o, z * s - o];
      pos.push(...p);
      if (x < n - 1) ePos.push(...p, p[0] + s, p[1], p[2]);
      if (y < n - 1) ePos.push(...p, p[0], p[1] + s, p[2]);
      if (z < n - 1) ePos.push(...p, p[0], p[1], p[2] + s);
    }
    const cube = new THREE.Group();
    cube.add(lines(ePos, { color: COLORS.violet, opacity: 0.32 }));
    cube.add(glowPoints(pos, { color: COLORS.cyan, size: 0.62 }));
    g.add(cube);
    const hello = label('>>> print("Hello, World")', { height: 0.62, box: true });
    hello.position.set(0, 4.6, 0);
    g.add(hello);
    st.labels.push(hello);
    st.update = (t) => {
      cube.rotation.y = t * 0.22;
      cube.rotation.x = 0.45 + Math.sin(t * 0.3) * 0.1;
    };
  }, 11.5);

  // 2 · Python & data: three clusters in a scatter plot.
  addStation(2, (st, g) => {
    const rand = rng(21);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
    const centers = [[-2.6, 1.1, 0.2], [2.6, 1.6, -1], [0.2, -2.1, 1.1]];
    const clusterColors = [COLORS.cyan, COLORS.violet2, COLORS.pink];
    const per = lowPower ? 150 : 260;
    const pos = [], col = [];
    centers.forEach((c, k) => {
      tmpColor.set(clusterColors[k]);
      for (let i = 0; i < per; i++) {
        pos.push(c[0] + gauss() * 0.85, c[1] + gauss() * 0.85, c[2] + gauss() * 0.85);
        col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    });
    const cloud = new THREE.Group();
    cloud.add(glowPoints(pos, { colors: col, size: 0.26 }));
    cloud.add(glowPoints(centers.flat(), { color: 0xffffff, size: 1.5, opacity: 0.85 }));
    cloud.add(lines([-5, -4, -3, 5, -4, -3, -5, -4, -3, -5, 4, -3, -5, -4, -3, -5, -4, 4], { color: COLORS.text, opacity: 0.18 }));
    g.add(cloud);
    const tag = label("data → clean → model → evaluate", { height: 0.5, box: true });
    tag.position.set(0, 4.8, 0);
    g.add(tag);
    st.labels.push(tag);
    st.update = (t) => {
      cloud.rotation.y = Math.sin(t * 0.2) * 0.6;
      cloud.rotation.x = Math.sin(t * 0.15) * 0.12;
    };
  }, 12.5);

  // 3 · Computer vision: a real "7" from the digits test set, as 8x8 voxels.
  addStation(3, (st, g) => {
    const DIGIT = [
      0, 0, 6, 14, 16, 13, 0, 0, 0, 0, 9, 9, 9, 15, 0, 0, 0, 0, 0, 0, 14, 9, 0, 0, 0, 0, 2, 10, 16, 16, 12, 0,
      0, 0, 13, 16, 12, 7, 3, 0, 0, 0, 3, 14, 6, 0, 0, 0, 0, 0, 6, 16, 2, 0, 0, 0, 0, 0, 10, 13, 0, 0, 0, 0,
    ];
    const box = new THREE.BoxGeometry(0.9, 0.9, 1);
    const mesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), 64);
    const dark = new THREE.Color(0x141c2e), top = new THREE.Color(COLORS.cyan), bottom = new THREE.Color(COLORS.violet);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3();
    const glow = [];
    DIGIT.forEach((v, i) => {
      const r = Math.floor(i / 8), c = i % 8;
      tmpColor.copy(top).lerp(bottom, r / 7);
      mesh.setColorAt(i, dark.clone().lerp(tmpColor, v / 16));
      if (v > 8) glow.push((c - 3.5) * 1.02, (3.5 - r) * 1.02, 0.2 + (v / 16) * 2.4);
    });
    const grid = new THREE.Group();
    grid.add(mesh);
    grid.add(glowPoints(glow, { color: COLORS.cyan, size: 0.9, opacity: 0.55 }));
    grid.rotation.x = -0.22;
    g.add(grid);
    const verdict = label("8×8 pixels → SVM → 7", { height: 0.55, box: true });
    verdict.position.set(0, 5.4, 0);
    const acc = label("98.89% test accuracy", { height: 0.5, color: "#22d3ee" });
    acc.position.set(0, -5.4, 0);
    g.add(verdict, acc);
    st.labels.push(verdict, acc);
    st.update = (t) => {
      DIGIT.forEach((v, i) => {
        const r = Math.floor(i / 8), c = i % 8;
        const depth = (0.18 + (v / 16) * 2.4) * (1 + 0.1 * Math.sin(t * 2 + c * 0.6 + r * 0.45));
        v3.set((c - 3.5) * 1.02, (3.5 - r) * 1.02, depth / 2);
        sc.set(1, 1, depth);
        mesh.setMatrixAt(i, m.compose(v3, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      grid.rotation.y = Math.sin(t * 0.35) * 0.5;
    };
    st.update(0);
  }, 15.5);

  // 4 · Language: a sphere of word-vectors with the ideas behind the NLP projects.
  addStation(4, (st, g) => {
    const N = lowPower ? 130 : 200, R = 4.3;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      pts.push(new THREE.Vector3(Math.cos(th) * r * R, y * R, Math.sin(th) * r * R));
    }
    const pos = [], col = [], ePos = [];
    pts.forEach((p, i) => {
      pos.push(p.x, p.y, p.z);
      tmpColor.set(i % 3 ? COLORS.violet2 : COLORS.cyan);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      const near = pts.map((q, j) => [p.distanceToSquared(q), j]).sort((a, b) => a[0] - b[0]).slice(1, 3);
      for (const [, j] of near) if (j > i) ePos.push(p.x, p.y, p.z, pts[j].x, pts[j].y, pts[j].z);
    });
    const sphere = new THREE.Group();
    sphere.add(glowPoints(pos, { colors: col, size: 0.34 }));
    sphere.add(lines(ePos, { color: COLORS.violet, opacity: 0.22 }));
    const words = ["tf-idf", "cosine", "tokens", "intent", "summary", "keywords", "n-grams", "naive bayes", "stop words", "spam?"];
    words.forEach((w, k) => {
      const p = pts[Math.floor(((k + 0.5) / words.length) * N)].clone().multiplyScalar(1.22);
      const s = label(w, { height: 0.38, color: k % 2 ? "#b4aef0" : "#22d3ee" });
      s.position.copy(p);
      sphere.add(s);
      st.labels.push(s);
    });
    g.add(sphere);
    st.update = (t) => {
      sphere.rotation.y = t * 0.16;
      sphere.rotation.z = Math.sin(t * 0.2) * 0.12;
    };
  }, 14.5);

  // 5 · Recommenders: films as a similarity graph around "3 Idiots".
  addStation(5, (st, g) => {
    const rand = rng(55);
    const others = [];
    while (others.length < 20) {
      const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (p.length() > 1 || p.length() < 0.45) continue;
      others.push(p.multiplyScalar(5));
    }
    const picks = [
      { name: "Chhichhore · 21.4%", p: new THREE.Vector3(3.3, 1.4, 0.6) },
      { name: "Munna Bhai MBBS · 16.8%", p: new THREE.Vector3(-3, 2.3, -0.6) },
      { name: "Dil Chahta Hai · 16.3%", p: new THREE.Vector3(0.4, -3.1, 1) },
    ];
    const all = [...others, ...picks.map((k) => k.p)];
    const ePos = [];
    all.forEach((p, i) => {
      all.map((q, j) => [p.distanceToSquared(q), j]).sort((a, b) => a[0] - b[0]).slice(1, 3)
        .forEach(([, j]) => { if (j > i) ePos.push(p.x, p.y, p.z, all[j].x, all[j].y, all[j].z); });
    });
    const graph = new THREE.Group();
    graph.add(lines(ePos, { color: COLORS.violet, opacity: 0.2 }));
    graph.add(glowPoints(others.flatMap((p) => [p.x, p.y, p.z]), { color: COLORS.violet2, size: 0.62, opacity: 0.8 }));
    graph.add(glowPoints(picks.flatMap((k) => [k.p.x, k.p.y, k.p.z]), { color: COLORS.cyan, size: 1.1 }));
    graph.add(glowPoints([0, 0, 0], { color: 0xffffff, size: 2 }));
    graph.add(lines(picks.flatMap((k) => [0, 0, 0, k.p.x, k.p.y, k.p.z]), { color: COLORS.cyan, opacity: 0.75 }));
    const center = label("3 Idiots", { height: 0.6, box: true });
    center.position.set(0, 1.1, 0);
    graph.add(center);
    st.labels.push(center);
    picks.forEach((k) => {
      const s = label(k.name, { height: 0.42, color: "#22d3ee" });
      s.position.copy(k.p).add(new THREE.Vector3(0, 0.75, 0));
      graph.add(s);
      st.labels.push(s);
    });
    // pulses travelling from the pick to its neighbours
    const pulses = glowPoints(new Array(picks.length * 3 * 3).fill(0), { color: 0xffffff, size: 0.5 });
    graph.add(pulses);
    const pp = pulses.geometry.attributes.position;
    g.add(graph);
    st.update = (t) => {
      graph.rotation.y = Math.sin(t * 0.22) * 0.55;
      graph.rotation.x = Math.sin(t * 0.17) * 0.1;
      picks.forEach((k, i) => {
        for (let j = 0; j < 3; j++) {
          const u = (t * 0.35 + j / 3 + i * 0.13) % 1;
          pp.setXYZ(i * 3 + j, k.p.x * u, k.p.y * u, k.p.z * u);
        }
      });
      pp.needsUpdate = true;
    };
  }, 13);

  // 6 · Shipping: the full-stack layers of SpamSMS Guardian with data flowing through.
  addStation(6, (st, g) => {
    const names = ["React + TypeScript UI", "FastAPI  /api/analyze", "TF-IDF + Naive Bayes", "SQLite  accounts"];
    const ys = [2.7, 0.9, -0.9, -2.7];
    const stack = new THREE.Group();
    const slab = new THREE.BoxGeometry(6.4, 0.08, 3.8);
    const edges = new THREE.EdgesGeometry(slab);
    ys.forEach((y, i) => {
      const fill = new THREE.Mesh(slab, new THREE.MeshBasicMaterial({ color: i % 2 ? COLORS.violet : COLORS.cyan, transparent: true, opacity: 0.09, depthWrite: false }));
      const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: i % 2 ? COLORS.violet2 : COLORS.cyan, transparent: true, opacity: 0.7 }));
      fill.position.y = outline.position.y = y;
      stack.add(fill, outline);
      const s = label(names[i], { height: 0.42 });
      s.position.set(0, y + 0.55, 2.3);
      stack.add(s);
      st.labels.push(s);
    });
    const rand = rng(66);
    const FLOW = 26;
    const flow = Array.from({ length: FLOW }, () => ({ x: (rand() - 0.5) * 5.6, z: (rand() - 0.5) * 3.2, u: rand(), speed: 0.12 + rand() * 0.2, down: rand() < 0.5 }));
    const flowPts = glowPoints(new Array(FLOW * 3).fill(0), { color: COLORS.green, size: 0.42 });
    stack.add(flowPts);
    const fp = flowPts.geometry.attributes.position;
    stack.rotation.x = 0.28;
    g.add(stack);
    st.update = (t, dt) => {
      stack.rotation.y = Math.sin(t * 0.25) * 0.5 - 0.2;
      flow.forEach((f, i) => {
        f.u = (f.u + dt * f.speed) % 1;
        const y = f.down ? lerp(2.7, -2.7, f.u) : lerp(-2.7, 2.7, f.u);
        fp.setXYZ(i, f.x, y, f.z);
      });
      fp.needsUpdate = true;
    };
  }, 15.5);

  // 7 · What's next: a dense knot of particles, deep learning and LLMs ahead.
  addStation(7, (st, g) => {
    const knot = new THREE.TorusKnotGeometry(3.7, 1.15, lowPower ? 170 : 280, lowPower ? 14 : 22);
    const src = knot.attributes.position;
    const rand = rng(77);
    const pos = [], col = [];
    const a = new THREE.Color(COLORS.violet), b = new THREE.Color(COLORS.pink), c = new THREE.Color(COLORS.cyan);
    for (let i = 0; i < src.count; i++) {
      pos.push(src.getX(i) + (rand() - 0.5) * 0.25, src.getY(i) + (rand() - 0.5) * 0.25, src.getZ(i) + (rand() - 0.5) * 0.25);
      const f = i / src.count;
      tmpColor.copy(f < 0.5 ? a : b).lerp(f < 0.5 ? b : c, (f % 0.5) * 2);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    knot.dispose();
    const cloud = glowPoints(pos, { colors: col, size: 0.16 });
    g.add(cloud);
    const orbit = new THREE.Group();
    const tools = ["PyTorch", "TensorFlow", "Ollama", "n8n", "MongoDB"];
    tools.forEach((name, i) => {
      const s = label(name, { height: 0.5, box: true });
      const ang = (i / tools.length) * Math.PI * 2;
      s.position.set(Math.cos(ang) * 6.6, Math.sin(ang * 2) * 1.2, Math.sin(ang) * 6.6);
      orbit.add(s);
      st.labels.push(s);
    });
    g.add(orbit);
    st.update = (t) => {
      cloud.rotation.y = t * 0.12;
      cloud.rotation.x = Math.sin(t * 0.1) * 0.3;
      orbit.rotation.y = -t * 0.1;
    };
  }, 21);

  // ---------------------------------------------------------------- the path between layers
  const PATH_DROP = 9;
  const path = new THREE.CatmullRomCurve3(P, false, "centripetal");
  {
    const pts = path.getPoints(700);
    const pos = [], col = [];
    const a = new THREE.Color(COLORS.cyan), b = new THREE.Color(COLORS.violet), c = new THREE.Color(COLORS.pink);
    for (let i = 0; i < pts.length - 1; i++) {
      for (const k of [i, i + 1]) {
        const f = k / (pts.length - 1);
        pos.push(pts[k].x, pts[k].y - PATH_DROP, pts[k].z);
        tmpColor.copy(f < 0.5 ? a : b).lerp(f < 0.5 ? b : c, (f % 0.5) * 2);
        col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    scene.add(lines(pos, { colors: col, opacity: 0.45 }));
  }
  const PULSES = lowPower ? 40 : 80;
  const pulseState = Array.from({ length: PULSES }, (_, i) => ({ u: i / PULSES, speed: 0.008 + (i % 7) * 0.002 }));
  const pulses = glowPoints(new Array(PULSES * 3).fill(0), { color: 0xffffff, size: 0.38, opacity: 0.9 });
  scene.add(pulses);
  const pulsePos = pulses.geometry.attributes.position;
  const pv = new THREE.Vector3();
  const updatePulses = (dt) => {
    pulseState.forEach((p, i) => {
      p.u = (p.u + dt * p.speed) % 1;
      path.getPointAt(p.u, pv);
      pulsePos.setXYZ(i, pv.x, pv.y - PATH_DROP, pv.z);
    });
    pulsePos.needsUpdate = true;
  };
  updatePulses(0);

  // ---------------------------------------------------------------- star dust
  {
    const rand = rng(3);
    const N = lowPower ? 1300 : 2600;
    const pos = [], col = [];
    for (let i = 0; i < N; i++) {
      pos.push((rand() - 0.5) * 150, (rand() - 0.5) * 90, 50 - rand() * 330);
      tmpColor.set(rand() < 0.7 ? COLORS.text : rand() < 0.5 ? COLORS.violet2 : COLORS.cyan);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    scene.add(glowPoints(pos, { colors: col, size: 0.32, opacity: 0.55 }));
  }

  // ---------------------------------------------------------------- camera rig
  let camPath, lookPath;
  const OVERVIEW = 8;
  function buildRig() {
    const narrow = small();
    const cams = [], looks = [];
    stations.forEach((st, i) => {
      const d = st.distance * (narrow ? 1.25 : 1);
      const side = narrow ? 0 : d * 0.3;
      const lift = narrow ? d * 0.2 : 0;
      cams.push(P[i].clone().add(new THREE.Vector3(-side, 0.8 - lift, d)));
      looks.push(P[i].clone().add(new THREE.Vector3(-side, -lift, 0)));
    });
    // Overview: pull far back so the whole path is visible behind the last sections.
    const mid = P[4];
    if (narrow) {
      cams.push(new THREE.Vector3(34, 62, 70));
      looks.push(new THREE.Vector3(0, -8, mid.z + 10));
    } else {
      cams.push(new THREE.Vector3(mid.x + 92, 46, mid.z + 30));
      looks.push(new THREE.Vector3(mid.x - 14, -4, mid.z + 4));
    }
    camPath = new THREE.CatmullRomCurve3(cams, false, "centripetal");
    lookPath = new THREE.CatmullRomCurve3(looks, false, "centripetal");
  }

  // Scroll position → station number (0..8), resting at each station while its text is centred.
  let anchors = [];
  function measure() {
    const vh = window.innerHeight;
    anchors = [...document.querySelectorAll("[data-station]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const y = r.height > vh ? top - vh * 0.25 : top + r.height / 2 - vh / 2;
        return { s: +el.dataset.station, y };
      })
      .sort((a, b) => a.y - b.y);
    if (anchors.length) anchors[0].y = Math.min(anchors[0].y, 0);
  }
  const dwell = (f) => {
    const x = clamp01((f - 0.15) / 0.7);
    return x * x * (3 - 2 * x);
  };
  function stationFromScroll() {
    const y = window.scrollY;
    if (!anchors.length || y <= anchors[0].y) return anchors[0]?.s ?? 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (y <= b.y) return lerp(a.s, b.s, dwell((y - a.y) / Math.max(1, b.y - a.y)));
    }
    return anchors[anchors.length - 1].s;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 600 ? 66 : 55;
    camera.updateProjectionMatrix();
    buildRig();
    measure();
  }
  window.addEventListener("resize", resize);
  new ResizeObserver(() => measure()).observe(document.body);
  resize();

  // Mouse parallax (desktop only).
  const mouse = new THREE.Vector2(), mouseSmooth = new THREE.Vector2();
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let current = stationFromScroll();
  const introStart = performance.now();
  const INTRO_MS = reduceMotion ? 0 : 2200;
  let elapsed = 0;
  const camPos = new THREE.Vector3(), lookPos = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt * timeScale;
    const target = stationFromScroll();
    current += (target - current) * (1 - Math.pow(0.0008, dt));
    if (Math.abs(target - current) < 1e-4) current = target;

    const u = clamp01(current / OVERVIEW);
    camPath.getPoint(u, camPos);
    lookPath.getPoint(u, lookPos);
    const intro = INTRO_MS ? clamp01(1 - (performance.now() - introStart) / INTRO_MS) : 0;
    const introEase = intro * intro * (3 - 2 * intro);
    camPos.z += introEase * 14;
    camPos.y += introEase * 3;
    mouseSmooth.lerp(mouse, 1 - Math.pow(0.02, dt));
    camPos.x += mouseSmooth.x * 1.1;
    camPos.y -= mouseSmooth.y * 0.7;
    camera.position.copy(camPos);
    camera.lookAt(lookPos);

    // Thinner fog when pulled back so the whole path shows.
    scene.fog.density = lerp(0.027, 0.0052, clamp01(current - 7));

    stations.forEach((st, i) => {
      const active = clamp01(1 - Math.abs(current - i) * 1.1);
      st.group.scale.setScalar(0.9 + 0.1 * active);
      for (const l of st.labels) l.material.opacity = active;
      st.update(elapsed, dt * timeScale, active);
    });
    updatePulses(dt * timeScale);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Add ?debug to the URL to inspect the camera from the console.
  if (new URLSearchParams(location.search).has("debug")) {
    window.__scene = { camera, get current() { return current; }, get target() { return stationFromScroll(); }, settle() { current = stationFromScroll(); } };
  }
}
