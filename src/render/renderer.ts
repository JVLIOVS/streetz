import * as THREE from 'three';
import type { MapData } from '../maps/types';
import type { SimEvent, SimWorld } from '../sim/world';
import type { GameAssets } from './assets';
import { ThirdPersonCamera } from './camera';
import { CityView } from './city';
import { Effects } from './effects';
import { DEFAULT_LOOK, HumanView, initHumans, type BaseAnim } from './human';
import { InteriorsView } from './interiors';
import { sharedUniforms, skyMaterial } from './materials';
import { PedRenderer } from './peds';
import { AdaptiveResolution, QUALITY, type QualityLevel, type QualityPreset } from './quality';
import { VehicleRenderer } from './vehicles';

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
  private player: HumanView;
  private playerSeq = 0;
  private playerWeapon = '';
  private lastInterior: string | null = null;
  private sky: THREE.Mesh;
  private preset: QualityPreset;
  private time = 0;
  private visTimer = 0;
  private peds = new PedRenderer();
  private vehicles: VehicleRenderer;
  readonly effects = new Effects();
  private interiors: InteriorsView;

  constructor(
    private canvas: HTMLCanvasElement,
    private map: MapData,
    private sim: SimWorld,
    public quality: QualityLevel,
    private assets: GameAssets,
  ) {
    initHumans(assets.character);
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
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xffc89a, 1.35);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.5);
    this.sun.castShadow = this.preset.shadows;
    this.configureShadows();
    this.scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMaterial(SKY_TOP, SKY_HORIZON));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.city = new CityView(map, { shadows: this.preset.shadows }, assets);
    this.scene.add(this.city.root);
    this.vehicles = new VehicleRenderer(assets);
    this.interiors = new InteriorsView(map);
    this.scene.add(this.vehicles.root, this.peds.root, this.effects.root, this.interiors.root);

    this.player = new HumanView(DEFAULT_LOOK);
    this.player.setOutline(true);
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
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.sun.castShadow = this.preset.shadows;
    this.configureShadows();
    this.scene.remove(this.city.root);
    this.city = new CityView(this.map, { shadows: this.preset.shadows }, this.assets);
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

  handleEvent(e: SimEvent) {
    this.effects.handle(e);
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
    let cx = 0;
    let cz = 0;
    if (p) {
      const s = p.state;
      const driving = s.vehicle >= 0 ? this.sim.vehicles.get(s.vehicle) : undefined;
      let x: number;
      let y: number;
      let z: number;
      let facing: number;
      if (driving) {
        const v = driving;
        x = v.prev.x + (v.state.x - v.prev.x) * alpha;
        y = v.prev.y + (v.state.y - v.prev.y) * alpha;
        z = v.prev.z + (v.state.z - v.prev.z) * alpha;
        let dy = v.state.yaw - v.prev.yaw;
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        facing = v.prev.yaw + dy * alpha;
      } else {
        x = p.prev.x + (s.x - p.prev.x) * alpha;
        y = p.prev.y + (s.y - p.prev.y) * alpha;
        z = p.prev.z + (s.z - p.prev.z) * alpha;
        let df = s.facing - p.prev.facing;
        if (df > Math.PI) df -= Math.PI * 2;
        if (df < -Math.PI) df += Math.PI * 2;
        facing = p.prev.facing + df * alpha;
      }
      cx = x;
      cz = z;
      if (s.interior !== this.lastInterior) {
        // went through a door: put the camera behind the player again
        this.lastInterior = s.interior;
        this.cam.snap(facing);
      }
      this.updatePlayerView(p, x, y, z, facing, dt);
      this.cam.update(x, y, z, facing, s.speed, forwardInput, dt, driving ? 'vehicle' : 'foot', driving?.state.speed ?? 0);
      this.interiors.show(s.interior);

      // Shadow camera follows the player, snapped to texels to avoid shimmering
      if (this.preset.shadows) {
        const texel = 90 / this.sun.shadow.mapSize.x;
        const sx = Math.round(x / texel) * texel;
        const sz = Math.round(z / texel) * texel;
        this.sun.target.position.set(sx, 0, sz);
        this.sun.position.set(sx + SUN_DIR.x * 120, SUN_DIR.y * 120, sz + SUN_DIR.z * 120);
      }

      this.visTimer -= dt;
      if (this.visTimer <= 0) {
        this.visTimer = 0.2;
        this.city.updateVisibility(x, z, this.preset.viewDistance, this.preset.lodDistance);
      }
    }
    const dynDist = Math.min(this.preset.viewDistance, 160);
    this.vehicles.sync(this.sim.vehicles, alpha, p?.state.vehicle ?? -1, cx, cz, dynDist);
    this.peds.sync(this.sim.peds, alpha, dt, cx, cz, Math.min(dynDist, 75));
    const roots = new Map<number, THREE.Object3D>();
    for (const [id, v] of this.vehicles.views) roots.set(id, v.root);
    this.peds.syncRiders(this.sim.vehicles, roots, dt);
    for (const v of this.sim.vehicles.values()) if (Math.hypot(v.state.x - cx, v.state.z - cz) < 120) this.effects.vehicleSmoke(v, dt);
    this.effects.update(dt, this.sim.pickups);

    this.sky.position.copy(this.cam.camera.position);
    this.renderer.render(this.scene, this.cam.camera);
  }

  private updatePlayerView(p: NonNullable<ReturnType<SimWorld['players']['get']>>, x: number, y: number, z: number, facing: number, dt: number) {
    const s = p.state;
    const view = this.player;
    const driving = s.vehicle >= 0 ? this.vehicles.views.get(s.vehicle) : undefined;
    if (driving) {
      // Sit in the car (visible through the windows), on the left seat
      const v = this.sim.vehicles.get(s.vehicle)!;
      if (view.root.parent !== driving.root.children[0]) driving.root.children[0].add(view.root);
      const moto = v.spec.twoWheels;
      view.root.position.set(moto ? 0 : -0.42, v.spec.seatY, moto ? 0.15 : 0.05);
      view.root.rotation.set(0, 0, 0);
      view.setBase('drive');
      // Only visible on two wheels: in a car the roof would cut the head
      view.root.visible = !!moto;
    } else {
      if (view.root.parent !== this.scene) this.scene.add(view.root);
      view.root.visible = true;
      view.root.position.set(x, y, z);
      view.root.rotation.set(0, facing, 0);
      const anim: BaseAnim = s.anim === 'drive' ? 'idle' : s.anim;
      view.setBase(anim);
      if (anim === 'walk') view.setSpeedScale(Math.max(0.6, s.speed / 2.2));
      else if (anim === 'run') view.setSpeedScale(Math.max(0.8, s.speed / 5.6));
    }
    const weapon = s.vehicle >= 0 ? 'none' : s.weapon === 'fist' ? 'none' : s.weapon;
    if (weapon !== this.playerWeapon) {
      this.playerWeapon = weapon;
      view.setWeapon(weapon as 'none' | 'pistol' | 'rifle');
    }
    if (s.actionSeq !== this.playerSeq) {
      this.playerSeq = s.actionSeq;
      if (s.action && !s.dead) view.playOverlay(s.action);
    }
    view.update(dt);
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
