"use client";

import * as React from "react";

/**
 * Raw-WebGL hero background: slow contour currents drifting across paper,
 * with a single accent thread carrying pulses left → right. No library,
 * DPR-capped, pauses offscreen, single static frame under reduced motion.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float t;

float band(vec2 uv, float freq, float speed, float thick) {
 float w = sin(uv.x * freq + t * speed + sin(uv.y * 3.0 + t * 0.22) * 1.4);
 float d = abs(uv.y * 6.0 - w * 1.2);
 return smoothstep(thick, 0.0, d);
}

void main() {
 vec2 uv = gl_FragCoord.xy / res;
 uv.x *= res.x / res.y;
 vec3 paper = vec3(0.961, 0.957, 0.937);
 vec3 ink = vec3(0.043, 0.047, 0.055);
 vec3 accent = vec3(0.118, 0.227, 0.541);

 float field = 0.0;
 field += band(uv + vec2(0.0, 0.9), 2.1, 0.16, 0.10) * 0.55;
 field += band(uv + vec2(1.7, -0.4), 3.2, -0.11, 0.07) * 0.4;
 field += band(uv + vec2(4.2, 0.3), 4.6, 0.08, 0.05) * 0.3;
 vec3 col = mix(paper, ink, clamp(field, 0.0, 1.0) * 0.10);

 // accent thread with traveling pulses
 float thread = abs(uv.y - 0.5 - sin(uv.x * 1.4 + t * 0.25) * 0.12);
 float pulses = pow(0.5 + 0.5 * sin(uv.x * 9.0 - t * 0.9), 6.0);
 float glow = smoothstep(0.035, 0.0, thread) * (0.25 + pulses * 0.9);
 col = mix(col, accent, clamp(glow, 0.0, 1.0) * 0.5);

 gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
 const shader = gl.createShader(type);
 if (!shader) throw new Error("WebGL shader allocation failed");
 gl.shaderSource(shader, src);
 gl.compileShader(shader);
 if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
 throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
 }
 return shader;
}

export function SignalField() {
 const ref = React.useRef<HTMLCanvasElement | null>(null);

 React.useEffect(() => {
 const canvas = ref.current;
 if (!canvas) return;
 const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
 if (!gl) return; // graceful: paper background remains

 const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

 let program: WebGLProgram | null = null;
 try {
 program = gl.createProgram();
 if (!program) return;
 gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
 gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
 gl.linkProgram(program);
 gl.useProgram(program);
 } catch {
 return;
 }

 const buf = gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER, buf);
 gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
 const loc = gl.getAttribLocation(program, "p");
 gl.enableVertexAttribArray(loc);
 gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

 const resLoc = gl.getUniformLocation(program, "res");
 const tLoc = gl.getUniformLocation(program, "t");

 const resize = () => {
 const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
 const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * 0.6));
 const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * 0.6));
 if (canvas.width !== w || canvas.height !== h) {
 canvas.width = w;
 canvas.height = h;
 gl.viewport(0, 0, w, h);
 }
 };

 let raf = 0;
 let visible = true;
 const start = performance.now();

 const draw = (now: number) => {
 resize();
 gl.uniform2f(resLoc, canvas.width, canvas.height);
 gl.uniform1f(tLoc, (now - start) / 1000);
 gl.drawArrays(gl.TRIANGLES, 0, 3);
 };

 if (reduced) {
 draw(start + 4000); // one composed static frame
 return;
 }

 const loop = (now: number) => {
 raf = requestAnimationFrame(loop);
 if (!visible || document.hidden) return;
 draw(now);
 };

 const observer = new IntersectionObserver(([entry]) => {
 visible = entry?.isIntersecting ?? true;
 });
 observer.observe(canvas);
 raf = requestAnimationFrame(loop);

 return () => {
 cancelAnimationFrame(raf);
 observer.disconnect();
 };
 }, []);

 return <canvas ref={ref} className="signal-field" aria-hidden="true" />;
}
