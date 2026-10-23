import * as THREE from 'three';

/** Shared uniforms (night factor drives lit windows, later neons and street lights). */
export const sharedUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

let gradient: THREE.DataTexture | null = null;
/** 3-tone ramp for the toon look: shadow / mid / lit. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

/** Common vertex prelude: local box coordinates (0..1), instance scale, local normal. */
const BOX_VARYINGS = /* glsl */ `
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vLNormal;
`;
const BOX_VERTEX = /* glsl */ `
vLocal = position + 0.5;
vLNormal = normal;
#ifdef USE_INSTANCING
vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
vScale = vec3(1.0);
#endif
`;

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/**
 * Building walls: one unit box per instance (scaled), windows/shops/balconies drawn
 * procedurally in the fragment shader so a whole chunk is a single draw call.
 * aParams = (style, seed, floorHeight, groundFloorHeight)
 */
export function buildingMaterial(): THREE.MeshToonMaterial {
  const m = toon(0xffffff);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aParams;\nvarying vec4 vParams;\n${BOX_VARYINGS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BOX_VERTEX}\nvParams = aParams;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;\nvarying vec4 vParams;\n${BOX_VARYINGS}\n${HASH}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 glow = vec3(0.0);
        if (abs(vLNormal.y) < 0.5) {
          bool alongX = abs(vLNormal.z) > 0.5;
          float faceW = alongX ? vScale.x : vScale.z;
          float u = (alongX ? vLocal.x : vLocal.z) * faceW;
          float v = vLocal.y * vScale.y;
          float style = vParams.x;
          float floorH = vParams.z;
          float gf = vParams.w;
          float edge = min(u, faceW - u);
          // Window columns centered on the facade
          float spacing = style > 0.5 && style < 1.5 ? 3.4 : 3.0;
          float n = max(1.0, floor(faceW / spacing));
          float cw = faceW / n;
          float fu = fract(u / cw);
          float col = floor(u / cw);
          float topMargin = vScale.y - (style < 0.5 ? 1.2 : 0.8);
          vec3 base = diffuseColor.rgb;
          // Ground floor: shop windows / entrance
          if (v < gf) {
            if (style != 1.0 && fu > 0.08 && fu < 0.92 && v > 0.35 && v < gf - 0.7) {
              float lit = step(0.35, hash12(vec2(col, vParams.y * 13.0 + (alongX ? 1.0 : 2.0))));
              diffuseColor.rgb = mix(vec3(0.16, 0.26, 0.32), vec3(0.45, 0.62, 0.7), smoothstep(0.35, gf, v) * 0.6);
              glow = vec3(1.0, 0.78, 0.45) * lit * uNight * 0.9;
            } else if (v > gf - 0.45) {
              diffuseColor.rgb = base * 1.08; // cornice band
            } else if (style == 2.0) {
              diffuseColor.rgb = base * 0.85;
            }
          } else if (v < topMargin) {
            float lv = (v - gf) / floorH;
            float fv = fract(lv);
            float row = floor(lv);
            bool win;
            if (style < 0.5) {
              // Haussmann: tall French windows + wrought-iron balcony lines on floors 1 and top
              win = fu > 0.27 && fu < 0.73 && fv > 0.18 && fv < 0.86;
              float topRow = floor((topMargin - gf) / floorH) - 1.0;
              if ((row < 0.5 || abs(row - topRow) < 0.5) && fv > 0.12 && fv < 0.3 && fu > 0.1 && fu < 0.9) {
                diffuseColor.rgb = vec3(0.12, 0.13, 0.17);
                win = false;
              }
              if (fv < 0.05) diffuseColor.rgb = base * 0.92; // floor line
            } else if (style < 1.5) {
              // Tower: regular grid, colored loggia band every 3 floors
              win = fu > 0.18 && fu < 0.82 && fv > 0.3 && fv < 0.8;
              if (mod(row, 3.0) < 0.5 && fv < 0.25) diffuseColor.rgb = base * 0.8;
            } else {
              win = fu > 0.12 && fu < 0.88 && fv > 0.25 && fv < 0.8;
            }
            if (win) {
              float h = hash12(vec2(col + vParams.y * 31.0, row + (alongX ? 7.0 : 3.0) + vLNormal.x * 5.0 + vLNormal.z * 11.0));
              vec3 glass = mix(vec3(0.18, 0.27, 0.42), vec3(0.42, 0.6, 0.78), fv * 0.7);
              diffuseColor.rgb = glass;
              float lit = step(0.55, h);
              glow = mix(vec3(1.0, 0.8, 0.5), vec3(0.75, 0.85, 1.0), step(0.85, h)) * lit * uNight;
            }
          } else {
            diffuseColor.rgb = base * 0.9; // top cornice
          }
          // Darken vertical edges and the base: cheap toon "outline" that defines silhouettes
          float e = smoothstep(0.0, 0.35, edge);
          diffuseColor.rgb *= mix(0.72, 1.0, e);
          diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.25, v));
        }
        `,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glow;');
  };
  m.customProgramCacheKey = () => 'building-v1';
  return m;
}

/**
 * Roofs: unit box whose top face is pulled inward by an absolute inset (aInset, meters),
 * giving Haussmann mansards (inset > 0) or flat roofs with a parapet look (inset = 0).
 */
export function roofMaterial(): THREE.MeshToonMaterial {
  const m = toon(0xffffff);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aInset;\n${BOX_VARYINGS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${BOX_VERTEX}\nif (position.y > 0.0) { transformed.xz -= sign(position.xz) * aInset / max(vScale.xz, vec2(0.01)); }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BOX_VARYINGS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Zinc roof seams
        if (abs(vLNormal.y) < 0.5) {
          float u = (abs(vLNormal.z) > 0.5 ? vLocal.x * vScale.x : vLocal.z * vScale.z);
          diffuseColor.rgb *= 0.9 + 0.1 * step(0.15, fract(u / 1.2));
        } else {
          diffuseColor.rgb *= 1.12;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'roof-v1';
  return m;
}

/**
 * Asphalt with procedural markings. Instances are oriented so local x runs along traffic.
 * aRoad = kind (0 street, 1 boulevard, 2 highway, 3 intersection)
 */
export function roadMaterial(): THREE.MeshToonMaterial {
  const m = toon(0x454b5a, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aRoad;\nvarying float vRoad;\n${BOX_VARYINGS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BOX_VERTEX}\nvRoad = aRoad;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vRoad;\n${BOX_VARYINGS}\n${HASH}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float L = vScale.x;
        float W = vScale.z;
        float u = vLocal.x * L;
        float v = (vLocal.z - 0.5) * W; // -W/2..W/2 across
        float av = abs(v);
        float paint = 0.0;
        vec3 paintCol = vec3(0.96, 0.95, 0.9);
        // asphalt grain
        diffuseColor.rgb *= 0.94 + 0.06 * hash12(floor(vec2(u, v) * 2.0));
        if (vRoad < 2.5) {
          // gutter
          if (av > W * 0.5 - 0.35) diffuseColor.rgb *= 1.25;
          bool dash = fract(u / 6.0) < 0.5;
          if (vRoad < 0.5) {
            if (av < 0.08 && dash) paint = 1.0;
          } else if (vRoad < 1.5) {
            if (abs(av - 0.2) < 0.08) paint = 1.0;
            if (abs(av - W * 0.25) < 0.08 && dash) paint = 1.0;
          } else {
            if (abs(av - 0.2) < 0.1) { paint = 1.0; paintCol = vec3(1.0, 0.82, 0.25); }
            if (abs(av - W * 0.25) < 0.1 && dash) paint = 1.0;
            if (abs(av - (W * 0.5 - 0.7)) < 0.1) paint = 1.0;
          }
          // Zebra crossings at both ends of street / boulevard segments
          if (vRoad < 1.5 && (u < 3.5 || u > L - 3.5) && (u > 0.5 && u < L - 0.5) && av < W * 0.5 - 0.6) {
            paint = step(0.5, fract(v / 1.1));
            paintCol = vec3(0.97);
          }
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, paintCol, paint);
        `,
      );
  };
  m.customProgramCacheKey = () => 'road-v1';
  return m;
}

export function waterMaterial(): THREE.MeshToonMaterial {
  const m = toon(0x2fa6c9, { transparent: true, opacity: 0.92 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vW;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float w = sin(vW.x * 0.35 + uTime * 1.3) + sin(vW.z * 0.9 - uTime * 0.8 + vW.x * 0.1);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.95, 1.0), smoothstep(1.55, 1.9, w) * 0.7);`,
      );
  };
  m.customProgramCacheKey = () => 'water-v1';
  return m;
}

/**
 * Sidewalks, squares, curbs and other flat solids: paving slabs drawn in world space on
 * top faces (thin joints + a slight per-slab tint), a darker strip along the edges.
 */
export function pavingMaterial(): THREE.MeshToonMaterial {
  const m = toon(0xffffff);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPW;\n${BOX_VARYINGS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BOX_VERTEX}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvec4 pw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\npw = instanceMatrix * pw;\n#endif\nvPW = (modelMatrix * pw).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPW;\n${BOX_VARYINGS}\n${HASH}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        if (vLNormal.y > 0.5 && vScale.x > 1.5 && vScale.z > 1.5) {
          vec2 q = vPW.xz / vec2(1.6, 1.1);
          q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5; // staggered rows
          vec2 f = fract(q);
          float joint = 1.0 - (1.0 - smoothstep(0.0, 0.04, f.x) * smoothstep(1.0, 0.96, f.x)) * 0.5
                            - (1.0 - smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.y)) * 0.5;
          float tint = 0.95 + 0.07 * hash12(floor(q));
          diffuseColor.rgb *= tint * mix(0.84, 1.0, clamp(joint, 0.0, 1.0));
          // worn border along the curb
          float ex = min(vLocal.x, 1.0 - vLocal.x) * vScale.x;
          float ez = min(vLocal.z, 1.0 - vLocal.z) * vScale.z;
          diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.15, 0.45, min(ex, ez)));
        } else if (abs(vLNormal.y) < 0.5) {
          diffuseColor.rgb *= 0.88; // curb sides read as stone
        }`,
      );
  };
  m.customProgramCacheKey = () => 'paving-v1';
  return m;
}

/** Gradient sky dome with a sun halo and soft drifting clouds (no texture). */
export function skyMaterial(top: THREE.Color, horizon: THREE.Color, sun = new THREE.Vector3(-0.45, 0.8, 0.35).normalize()): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: top }, uHorizon: { value: horizon }, uSun: { value: sun }, uTime: sharedUniforms.uTime, uNight: sharedUniforms.uNight },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform float uTime; uniform float uNight; varying vec3 vDir;
      ${HASH}
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 1.6, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(t, 0.7));
        // sun disc + warm halo
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(sd, 8.0) * 0.25 + pow(sd, 64.0) * 0.5) * (1.0 - uNight);
        col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.9975, 0.999, sd) * (1.0 - uNight));
        // soft cartoon clouds on a flat layer above the city
        if (d.y > 0.02) {
          vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
          float n = noise(uv) * 0.55 + noise(uv * 2.1) * 0.3 + noise(uv * 4.3) * 0.15;
          float c = smoothstep(0.52, 0.68, n) * smoothstep(0.02, 0.25, d.y);
          vec3 cloud = mix(vec3(0.93, 0.92, 0.98), vec3(1.0, 0.95, 0.88), sd);
          col = mix(col, cloud * mix(1.0, 0.35, uNight), c * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
