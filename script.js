// ---------------------------------------------------------
// 1. LOAD YOUR CLEANED CSV — same file the main map uses.
//    We only need the row count here, not the fields.
// ---------------------------------------------------------
d3.csv("data/meteorites_clean.csv").then(data => {
  init(data.length);
}).catch(err => {
  console.warn("Could not load data/meteorites_clean.csv — using a sample count of 3456.", err);
  init(3456);
});

// ---------------------------------------------------------
// 2. MAIN INIT
// ---------------------------------------------------------
function init(meteoroidCount) {

  const canvas = document.getElementById("space-canvas");
  const ctx = canvas.getContext("2d");

  let width, height;
  let particles = [];

  // Safety cap: purely a performance guard. Canvas can handle
  // tens of thousands of simple circles smoothly, but if your
  // real dataset is much larger than that, capping keeps the
  // animation buttery. Adjust MAX_PARTICLES if you test higher.
  const MAX_PARTICLES = 20000;
  const actualCount = Math.min(meteoroidCount, MAX_PARTICLES);

  // ---------------------------------------------------------
  // 3. CREATE PARTICLES — pure ambient drift only. This is the
  //    landing page, not the scroll/shower page, so there's no
  //    fall behavior here anymore — just a calm floating field.
  // ---------------------------------------------------------
  function createParticles() {
    particles = [];
    for (let i = 0; i < actualCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: 0.8 + Math.random() * 1.6,
        alpha: 0.3 + Math.random() * 0.5
      });
    }
  }

  // ---------------------------------------------------------
  // 4. RESIZE — canvas must be sized in actual pixels, not
  //    just CSS, or circles render blurry
  // ---------------------------------------------------------
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    createParticles();
  }

  // ---------------------------------------------------------
  // 5. ANIMATION LOOP — simple ambient float, wraps at edges
  // ---------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ff8a5c";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -5) p.x = width + 5;
      if (p.x > width + 5) p.x = -5;
      if (p.y < -5) p.y = height + 5;
      if (p.y > height + 5) p.y = -5;

      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}