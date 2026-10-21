import * as THREE from 'three';
import type { MapData } from '../maps/types';
import type { SimWorld } from '../sim/world';
import { ThirdPersonCamera } from './camera';
import { CharacterView } from './character';
import { CityView } from './city';
import { sharedUniforms, skyMaterial } from './materials';
import { AdaptiveResolution, QUALITY, type QualityLevel, type QualityPreset } from './quality';

const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
const SKY_TOP = new THREE.Color(0x3c8dff);
const SKY_HORIZON = new THREE.Color(0xffd9a8);

/** Owns the three.js scene. Reads the sim, never writes to it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: ThirdPersonCamera;
  readonly adaptive: AdaptiveResolution;
  private city: CityView;
  private sun: THREE.DirectionalLight;
  private player: CharacterView;
  private sky: THREE.Mesh;
  private preset: QualityPreset;
  private time = 0;
  private visTimer = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private map: MapData,
    private sim: SimWorld,
    public quality: QualityLevel,
  ) {
    this.preset = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.adaptive = new AdaptiveResolution(this.preset.minPixelRatio, Math.min(this.preset.maxPixelRatio, devicePixelRatio));

    this.cam = new ThirdPersonCamera(innerWidth / innerHeight, sim);
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), this.preset.viewDistance * 0.45, this.preset.viewDistance);
    this.scene.background = SKY_HORIZON.clone();

    // Warm, saturated lighting
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xffc89a, 1.3);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    this.sun.castShadow = this.preset.shadows;
    this.configureShadows();
    this.scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMaterial(SKY_TOP, SKY_HORIZON));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.city = new CityView(map, { shadows: this.preset.shadows });
    this.scene.add(this.city.root);

    this.player = new CharacterView();
    this.scene.add(this.player.root);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private configureShadows() {
    const s = this.sun.shadow;
    const size = this.preset.shadowMapSize || 512;
    s.mapSize.set(size, size);
    const half = 45;
    s.camera.left = -half;
    s.camera.right = half;
    s.camera.top = half;
    s.camera.bottom = -half;
    s.camera.near = 1;
    s.camera.far = 260;
    s.bias = -0.0008;
    s.normalBias = 0.04;
    s.camera.updateProjectionMatrix();
    if (s.map) {
      s.map.dispose();
      (s as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    this.preset = QUALITY[q];
    this.adaptive.setRange(this.preset.minPixelRatio, Math.min(this.preset.maxPixelRatio, devicePixelRatio));
    this.adaptive.scale = Math.min(this.preset.maxPixelRatio, devicePixelRatio);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.preset.viewDistance * 0.45;
    fog.far = this.preset.viewDistance;
    // Shadow toggling requires rebuilding the city meshes' flags and recompiling materials.
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.sun.castShadow = this.preset.shadows;
    this.configureShadows();
    this.scene.remove(this.city.root);
    this.city = new CityView(this.map, { shadows: this.preset.shadows });
    this.scene.add(this.city.root);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(this.adaptive.scale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  /**
   * @param alpha interpolation factor between the previous and current sim tick
   * @param forwardInput joystick forward component, for camera auto-recentering
   */
  render(playerId: string, alpha: number, dt: number, forwardInput: number) {
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    if (this.adaptive.push(dt)) this.resize();

    const p = this.sim.players.get(playerId);
    if (p) {
      const s = p.state;
      const x = p.prev.x + (s.x - p.prev.x) * alpha;
      const y = p.prev.y + (s.y - p.prev.y) * alpha;
      const z = p.prev.z + (s.z - p.prev.z) * alpha;
      let df = s.facing - p.prev.facing;
      if (df > Math.PI) df -= Math.PI * 2;
      if (df < -Math.PI) df += Math.PI * 2;
      this.player.root.position.set(x, y, z);
      this.player.root.rotation.y = p.prev.facing + df * alpha;
      this.player.animate(s.anim, s.speed, dt, this.time);
      this.cam.update(x, y, z, s.facing, s.speed, forwardInput, dt);

      // Shadow camera follows the player, snapped to texels to avoid shimmering
      if (this.preset.shadows) {
        const texel = 90 / this.sun.shadow.mapSize.x;
        const sx = Math.round(x / texel) * texel;
        const sz = Math.round(z / texel) * texel;
        this.sun.target.position.set(sx, 0, sz);
        this.sun.position.set(sx + SUN_DIR.x * 120, SUN_DIR.y * 120, sz + SUN_DIR.z * 120);
      } else {
        this.sun.position.copy(SUN_DIR).multiplyScalar(120);
        this.sun.target.position.set(0, 0, 0);
      }

      this.visTimer -= dt;
      if (this.visTimer <= 0) {
        this.visTimer = 0.2;
        this.city.updateVisibility(x, z, this.preset.viewDistance, this.preset.lodDistance);
      }
    }
    this.sky.position.copy(this.cam.camera.position);
    this.renderer.render(this.scene, this.cam.camera);
  }

  stats() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      pixelRatio: this.renderer.getPixelRatio(),
      quality: this.quality,
    };
  }
}
