'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero's point field: a cloud of points reorganising under the cursor.
 *
 * Every point holds two seats — one scattered, one inside a cluster — and the
 * attractor blends between them locally. Sweep the cursor and that region of
 * the space snaps into structure while the rest stays diffuse.
 *
 * Hand-written WebGL, no library. The shaders are GLSL ES 1.00 so one code path
 * runs on both `webgl2` and `webgl` contexts, and every per-frame cost is a
 * uniform write — the geometry is uploaded once and never touched again, so the
 * main thread does nothing but set five floats per frame.
 *
 * It degrades all the way down: no WebGL at all and the canvas never mounts,
 * leaving the hero exactly as it is without it. A visitor who asked for reduced
 * motion gets one static frame — texture, no movement. Off-screen or a
 * backgrounded tab stops the loop entirely.
 */

const VERTEX_SHADER = `
precision mediump float;

attribute vec2 aScatter;
attribute vec2 aCluster;
attribute float aSeed;

uniform float uTime;
uniform vec2  uAttractor;
uniform float uRadius;
uniform float uStrength;
uniform float uPointScale;

varying float vPull;

void main() {
  // Slow independent drift, so the field still breathes when nothing moves.
  vec2 drift = vec2(
    sin(uTime * 0.21 + aSeed * 6.2831),
    cos(uTime * 0.17 + aSeed * 4.1234)
  ) * 0.018;

  vec2 base = aScatter + drift;

  // Local reorganisation. The nearer the attractor, the further a point
  // travels toward its cluster seat.
  float d = distance(base, uAttractor);
  float pull = smoothstep(uRadius, 0.0, d) * uStrength;
  pull = pull * pull * (3.0 - 2.0 * pull);

  vPull = pull;
  gl_Position = vec4(mix(base, aCluster + drift * 0.4, pull), 0.0, 1.0);
  gl_PointSize = uPointScale * (1.0 + pull * 2.4);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform vec3 uColor;
varying float vPull;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float r = length(offset);
  if (r > 0.5) discard;

  // Soft disc rather than a hard dot: at this size a hard edge aliases badly.
  float disc = 1.0 - smoothstep(0.34, 0.5, r);
  gl_FragColor = vec4(uColor, disc * (0.30 + vPull * 0.62));
}
`;

/** ClickHouse yellow, #FAFF69. */
const COLOR: [number, number, number] = [250 / 255, 255 / 255, 105 / 255];
const CLUSTER_COUNT = 7;
const INFLUENCE_RADIUS = 0.5;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // A shader that will not compile is a bug in this file, not a browser
    // limitation — say so loudly and let the hero fall back.
    console.error('LatentField shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
/** Two uniform samples summed: clusters get a soft centre instead of a hard disc. */
function jitter(): number {
  return (Math.random() + Math.random() - 1) * 0.11;
}

function buildGeometry(count: number) {
  const scatter = new Float32Array(count * 2);
  const cluster = new Float32Array(count * 2);
  const seed = new Float32Array(count);

  const centres = Array.from({ length: CLUSTER_COUNT }, () => [
    (Math.random() * 2 - 1) * 0.82,
    (Math.random() * 2 - 1) * 0.72,
  ]);

  for (let i = 0; i < count; i++) {
    // Slight overscan so the edges of the hero are not visibly bare.
    scatter[i * 2] = (Math.random() * 2 - 1) * 1.06;
    scatter[i * 2 + 1] = (Math.random() * 2 - 1) * 1.06;

    const centre = centres[(Math.random() * CLUSTER_COUNT) | 0];
    cluster[i * 2] = centre[0] + jitter();
    cluster[i * 2 + 1] = centre[1] + jitter();

    seed[i] = Math.random();
  }

  return { scatter, cluster, seed };
}

/**
 * What the field is doing right now.
 *
 * `idle` is the hero's behaviour: the attractor follows the cursor, or walks a
 * Lissajous path on a touch device.
 *
 * The other two drive the field from an outside signal instead of the cursor:
 * `searching` releases the clustering so the points fall back to their
 * scattered seats, and `settled` pulls them into a tight cluster at the centre.
 * Nothing in the workshop uses them — they belonged to the removed image-search
 * page — but driving the same shader this way costs one uniform write.
 */
export type LatentPhase = 'idle' | 'searching' | 'settled';

export function LatentField({ className = '', phase = 'idle' }: { className?: string; phase?: LatentPhase }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  // Mirrored into a ref because the frame loop has to read the current phase
  // without the effect re-running: the effect owns the WebGL context, and
  // re-running it on every phase change would tear down and rebuild the context
  // mid-interaction.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false }) ??
      canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })) as
      | WebGLRenderingContext
      | null;

    if (!gl) {
      setFailed(true);
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();

    if (!vertex || !fragment || !program) {
      setFailed(true);
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('LatentField program failed to link:', gl.getProgramInfoLog(program));
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    // ── Geometry, uploaded once ──────────────────────────────────────────────
    const area = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    const narrow = canvas.clientWidth < 640;
    const count = Math.min(narrow ? 1100 : 2600, Math.max(500, Math.round(area / 620)));
    const { scatter, cluster, seed } = buildGeometry(count);

    const buffers: WebGLBuffer[] = [];
    function bindAttribute(name: string, data: Float32Array, size: number) {
      const buffer = gl!.createBuffer();
      if (!buffer) return;
      buffers.push(buffer);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
      const location = gl!.getAttribLocation(program!, name);
      if (location < 0) return;
      gl!.enableVertexAttribArray(location);
      gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0);
    }

    bindAttribute('aScatter', scatter, 2);
    bindAttribute('aCluster', cluster, 2);
    bindAttribute('aSeed', seed, 1);

    const uniforms = {
      time: gl.getUniformLocation(program, 'uTime'),
      attractor: gl.getUniformLocation(program, 'uAttractor'),
      radius: gl.getUniformLocation(program, 'uRadius'),
      strength: gl.getUniformLocation(program, 'uStrength'),
      pointScale: gl.getUniformLocation(program, 'uPointScale'),
      color: gl.getUniformLocation(program, 'uColor'),
    };

    gl.uniform3fv(uniforms.color, COLOR);
    // Written once no longer: the radius is animated per phase in draw(), so
    // this is only the starting value the hero was tuned with.
    const radiusBase = INFLUENCE_RADIUS;
    let radius = radiusBase;
    gl.uniform1f(uniforms.radius, radius);

    // Additive: overlapping points in a cluster brighten each other, which is
    // what makes a cluster read as denser rather than merely closer together.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    // ── Sizing ───────────────────────────────────────────────────────────────
    let pointScale = 2;
    function resize() {
      // Capped: past 2× the fill cost buys nothing you can see.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
      }
      gl!.viewport(0, 0, width, height);
      pointScale = 3.2 * dpr;
      gl!.uniform1f(uniforms.pointScale, pointScale);
    }
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // ── Attractor ────────────────────────────────────────────────────────────
    const target = { x: 0.35, y: 0.1 };
    const current = { x: 0.35, y: 0.1 };
    let strength = 0;
    let pointerSeen = false;

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      pointerSeen = true;
    }

    // Listening on the window, not the canvas: the canvas sits behind the
    // headline and the CTAs, so pointer events never reach it.
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // ── Frame loop ───────────────────────────────────────────────────────────
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let visible = true;
    let start = performance.now();

    function draw(time: number) {
      const t = (time - start) / 1000;

      const active = phaseRef.current;

      if (active === 'searching') {
        // Nothing to cluster around yet. The attractor drifts wide and slow and
        // the pull decays, so the field visibly loses its structure — the
        // opposite of an answer.
        target.x = Math.sin(t * 0.5) * 0.85;
        target.y = Math.cos(t * 0.41) * 0.6;
      } else if (active === 'settled') {
        // Dead centre, behind the results that just appeared.
        target.x = 0;
        target.y = 0;
      } else if (!pointerSeen) {
        // With no pointer — a touch device, or before the first move — the
        // attractor walks a Lissajous path so the field is alive either way.
        target.x = Math.sin(t * 0.21) * 0.62;
        target.y = Math.cos(t * 0.17) * 0.44;
      }

      // Weighted follow. Snapping the attractor to the cursor makes the
      // clustering feel like a hover state; easing makes it feel like mass.
      // `searching` moves faster because it is agitation, not weight.
      const follow = active === 'searching' ? 0.09 : 0.055;
      current.x += (target.x - current.x) * follow;
      current.y += (target.y - current.y) * follow;

      // The pull itself is the phase's real signal: released while the query is
      // in flight, hauled in once it lands.
      const wanted = active === 'searching' ? 0.08 : 1;
      const rate   = active === 'settled' ? 0.05 : 0.02;
      strength += (wanted - strength) * rate;

      // A settled cluster is tight; an unresolved one has no locality worth
      // drawing, so the radius opens up and the pull spreads to nothing.
      const wantedRadius = active === 'settled' ? 0.55 : active === 'searching' ? 1.6 : radiusBase;
      radius += (wantedRadius - radius) * 0.04;

      gl!.uniform1f(uniforms.time, t);
      gl!.uniform2f(uniforms.attractor, current.x, current.y);
      gl!.uniform1f(uniforms.strength, strength);
      gl!.uniform1f(uniforms.radius, radius);

      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.POINTS, 0, count);
    }

    function loop(time: number) {
      draw(time);
      frame = requestAnimationFrame(loop);
    }

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function play() {
      if (frame || !visible || document.hidden || reduced.matches) return;
      // Restart the clock so a paused tab does not resume mid-jump.
      start = performance.now() - 1000;
      frame = requestAnimationFrame(loop);
    }

    if (reduced.matches) {
      // One frame: the composition without the movement.
      strength = 1;
      draw(performance.now() + 2000);
    } else {
      play();
    }

    // Nothing renders while the hero is scrolled away.
    const intersectionObserver = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) play();
      else stop();
    }, { threshold: 0 });
    intersectionObserver.observe(canvas);

    function onVisibility() {
      if (document.hidden) stop();
      else play();
    }
    document.addEventListener('visibilitychange', onVisibility);

    function onReducedChange() {
      stop();
      if (reduced.matches) {
        strength = 1;
        draw(performance.now() + 2000);
      } else {
        play();
      }
    }
    reduced.addEventListener('change', onReducedChange);

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onReducedChange);

      buffers.forEach(buffer => gl.deleteBuffer(buffer));
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      // Frees the GPU allocation immediately instead of waiting for GC.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
