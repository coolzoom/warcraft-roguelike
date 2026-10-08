import * as THREE from 'three';

/** 4-band toon ramp shared by every material: soft cel shading like hand-painted figurines. */
const RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([105, 165, 220, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

/** Toon material with a warm fresnel rim so silhouettes pop against the dirt road. */
export function toonMat(params: THREE.MeshToonMaterialParameters) {
  const mat = new THREE.MeshToonMaterial({ gradientMap: RAMP, ...params });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
      outgoingLight += vec3(1.0, 0.92, 0.8) * rimF * 0.25;
      #include <opaque_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => 'toon-rim';
  return mat;
}

export function toon(color: number, glow = 0) {
  return toonMat({ color, emissive: glow ? color : 0x000000, emissiveIntensity: glow });
}

export function add<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x = 0, y = 0, z = 0) {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 16) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
export const torus = (r: number, tube: number, m: THREE.Material, arc = Math.PI * 2) =>
  new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24, arc), m);

/** Tapered horn / spike that curls along a quadratic arc in its local XY plane, base at the origin. */
export function horn(len: number, r: number, curl: number, m: THREE.Material) {
  const path = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len * 0.6, 0), new THREE.Vector3(curl, len, 0));
  const segs = 12;
  const radial = 8;
  const geo = new THREE.TubeGeometry(path, segs, r, radial, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i <= segs; i++) {
    const p = path.getPoint(i / segs);
    const k = 1 - (i / segs) * 0.92;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      pos.setXYZ(idx, p.x + (pos.getX(idx) - p.x) * k, p.y + (pos.getY(idx) - p.y) * k, p.z + (pos.getZ(idx) - p.z) * k);
    }
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, m);
  mesh.add(new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m));
  return mesh;
}
