import * as THREE from 'three';

const MODE_TRANSLATE = 'translate';
const MODE_ROTATE    = 'rotate';
const MODE_SCALE     = 'scale';

export class Gizmo {
    constructor(scene, camera, domElement) {
        this.mainScene = scene;
        this.camera = camera;
        this.dom = domElement || document.querySelector('canvas');

        this.scene = new THREE.Scene();  // отдельная сцена для второго прохода

        this.mode = MODE_TRANSLATE;
        this.target = null;
        this.enabled = false;
        this.snapEnabled = false;
        this.snapSize = 0.5;

        this.root = new THREE.Group();
        this.root.renderOrder = 999;
        this.scene.add(this.root);
        this.root.visible = false;

        this.gTranslate = this._buildTranslateGizmo();
        this.gRotate    = this._buildRotateGizmo();
        this.gScale     = this._buildScaleGizmo();
        this.gPlanes    = this._buildPlaneHandles();

        this.root.add(this.gTranslate, this.gRotate, this.gScale, this.gPlanes);
        this._setModeVisibility();

        this._drag = null;
        this._raycaster = new THREE.Raycaster();
        this._bind();
    }

    // === Построение ===

    _arrow(color, dir) {
        const g = new THREE.Group();

        const shaftLen = 1.4;
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, shaftLen, 8),
            new THREE.MeshBasicMaterial({ color })
        );
        shaft.position.y = shaftLen / 2;

        const headLen = 0.3;
        const head = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, headLen, 12),
            new THREE.MeshBasicMaterial({ color })
        );
        head.position.y = shaftLen + headLen / 2;

        g.add(shaft, head);

        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
        g.quaternion.copy(quat);

        g.traverse(o => { if (o.isMesh) o.userData.gizmoPart = true; });
        g.userData.axis = dir.x ? 'x' : dir.y ? 'y' : 'z';
        g.userData.kind = 'axis';

        return g;
    }

    _buildTranslateGizmo() {
        const g = new THREE.Group();
        g.name = 'gizmo-translate';
        g.add(
            this._arrow(0xff5555, new THREE.Vector3(1, 0, 0)),
            this._arrow(0x55ff55, new THREE.Vector3(0, 1, 0)),
            this._arrow(0x5577ff, new THREE.Vector3(0, 0, 1))
        );
        return g;
    }

    _buildScaleGizmo() {
        const g = new THREE.Group();
        g.name = 'gizmo-scale';

        const make = (color, dir) => {
            const a = this._arrow(color, dir);
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.16, 0.16),
                new THREE.MeshBasicMaterial({ color })
            );
            const end = new THREE.Vector3(0, 1.7, 0).applyQuaternion(
                new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0), dir
                )
            );
            box.position.copy(end);
            g.add(a, box);
            return a;
        };

        g.add(
            make(0xff5555, new THREE.Vector3(1, 0, 0)),
            make(0x55ff55, new THREE.Vector3(0, 1, 0)),
            make(0x5577ff, new THREE.Vector3(0, 0, 1))
        );
        return g;
    }

    _buildRotateGizmo() {
        const g = new THREE.Group();
        g.name = 'gizmo-rotate';

        const makeRing = (color, axis) => {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1.3, 0.02, 8, 64),
                new THREE.MeshBasicMaterial({ color })
            );
            if (axis === 'x') ring.rotation.y = Math.PI / 2;
            if (axis === 'z') ring.rotation.x = Math.PI / 2;
            ring.userData.gizmoPart = true;
            ring.userData.axis = axis;
            ring.userData.kind = 'ring';
            g.add(ring);
        };

        makeRing(0xff5555, 'x');
        makeRing(0x55ff55, 'y');
        makeRing(0x5577ff, 'z');
        return g;
    }

    _buildPlaneHandles() {
        const g = new THREE.Group();
        g.name = 'gizmo-planes';

        const makePlane = (color, normalAxis) => {
            const size = 0.35;
            const geo = new THREE.PlaneGeometry(size, size);
            const mat = new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.65,
                depthTest: false,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.renderOrder = 1000;

            const off = 0.9;
            if (normalAxis === 'x') {
                mesh.position.set(off * 0.5, off * 0.5, off);
                mesh.rotation.y = Math.PI / 2;
            } else if (normalAxis === 'y') {
                mesh.position.set(off, off * 0.35, off);
                mesh.rotation.x = -Math.PI / 2;
            } else if (normalAxis === 'z') {
                mesh.position.set(off, off, off * 0.5);
            }

            mesh.userData.gizmoPart = true;
            mesh.userData.axis = normalAxis;
            mesh.userData.kind = 'plane';
            mesh.userData.planeNormal = normalAxis;
            g.add(mesh);
        };

        makePlane(0xff5555, 'x');
        makePlane(0x55ff55, 'y');
        makePlane(0x5577ff, 'z');

        return g;
    }

    _setModeVisibility() {
        this.gTranslate.visible = this.mode === MODE_TRANSLATE;
        this.gRotate.visible    = this.mode === MODE_ROTATE;
        this.gScale.visible     = this.mode === MODE_SCALE;
        this.gPlanes.visible    = this.mode === MODE_TRANSLATE;
    }

    // === API ===

    setMode(mode) {
        this.mode = mode;
        this._setModeVisibility();
    }

    setTarget(obj) {
        this.target = obj;
        this.root.visible = !!obj && this.enabled;
        if (obj) this.sync();
    }

    sync() {
        if (!this.target) return;
        this.target.updateMatrixWorld();
        this.target.getWorldPosition(this.root.position);
        this.target.getWorldQuaternion(this.root.quaternion);

        const camPos = this.camera.position;
        const dist = camPos.distanceTo(this.root.position);
        const s = dist * 0.14;
        this.root.scale.setScalar(s);
    }

    // === Ввод ===

    _bind() {
        this.dom.addEventListener('mousedown', e => this._onDown(e));
        window.addEventListener('mousemove', e => this._onMove(e));
        window.addEventListener('mouseup', e => this._onUp(e));
    }

    _pickAxis(e) {
        const rect = this.dom.getBoundingClientRect();
        const ndc = {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1
        };
        this._raycaster.setFromCamera(ndc, this.camera);

        const active = [];
        if (this.mode === MODE_TRANSLATE) { active.push(this.gTranslate, this.gPlanes); }
        else if (this.mode === MODE_ROTATE) { active.push(this.gRotate); }
        else if (this.mode === MODE_SCALE)    { active.push(this.gScale); }

        const meshes = [];
        for (const g of active) {
            g.traverse(o => { if (o.isMesh || o.isLineSegments) meshes.push(o); });
        }
        if (meshes.length === 0) return null;

        this.root.updateMatrixWorld(true);

        const hits = this._raycaster.intersectObjects(meshes, false);
        if (hits.length === 0) return null;

        let node = hits[0].object;
        while (node && !node.userData.axis) node = node.parent;
        if (!node) return null;

        return {
            axis: node.userData.axis,
            kind: node.userData.kind,
            planeNormal: node.userData.planeNormal
        };
    }

    _onDown(e) {
        if (!this.enabled || !this.target) return;
        if (e.button !== 0) return;

        const hit = this._pickAxis(e);
        if (!hit) return;

        e.preventDefault();
        e.stopPropagation();

        this._drag = {
            kind: hit.kind,
            axis: hit.axis,
            startMouse: { x: e.clientX, y: e.clientY },
            startPosition: this.target.position.clone(),
            startScale: this.target.scale.clone(),
            startQuaternion: this.target.quaternion.clone(),
            startRotationEuler: new THREE.Euler().copy(this.target.rotation)
        };

        if (hit.kind === 'axis') {
            const axisVec = new THREE.Vector3(
                hit.axis === 'x' ? 1 : 0,
                hit.axis === 'y' ? 1 : 0,
                hit.axis === 'z' ? 1 : 0
            );
            this._drag.axisVec = axisVec;

            const worldPos = this.target.position.clone();
            const worldEnd = worldPos.clone().add(axisVec);
            const sp0 = this._projectToScreen(worldPos);
            const sp1 = this._projectToScreen(worldEnd);
            const dir = new THREE.Vector2().subVectors(sp1, sp0);
            if (dir.lengthSq() < 1e-6) dir.set(0, -1);
            this._drag.screenDir = dir.normalize();
        }
        else if (hit.kind === 'plane') {
            const normal = new THREE.Vector3(
                hit.planeNormal === 'x' ? 1 : 0,
                hit.planeNormal === 'y' ? 1 : 0,
                hit.planeNormal === 'z' ? 1 : 0
            );
            this._drag.planeNormal = normal;
            this._drag.planePoint = this.target.position.clone();

            const startHit = this._mousePlaneIntersect(e, normal, this._drag.planePoint);
            this._drag.startPlanePoint = startHit;
        }
        else if (hit.kind === 'ring') {
            const axisVec = new THREE.Vector3(
                hit.axis === 'x' ? 1 : 0,
                hit.axis === 'y' ? 1 : 0,
                hit.axis === 'z' ? 1 : 0
            );
            this._drag.axisVec = axisVec;
            this._drag.planeNormal = axisVec;
            this._drag.planePoint = this.target.position.clone();
            this._drag.startAngle = 0;
        }

        document.body.style.cursor = 'grabbing';
    }

    _onMove(e) {
        if (!this.enabled) return;

        if (!this._drag) {
            const hit = this._pickAxis(e);
            this.dom.style.cursor = hit ? 'grab' : '';
            return;
        }

        if (this._drag.kind === 'axis') {
            if (this.mode === MODE_TRANSLATE) this._dragTranslate(e);
            if (this.mode === MODE_SCALE)     this._dragScale(e);
        }
        else if (this._drag.kind === 'plane') {
            this._dragPlane(e);
        }
        else if (this._drag.kind === 'ring') {
            this._dragRotate(e);
        }

        if (this.snapEnabled && this.mode === MODE_TRANSLATE) {
            this.target.position.x = this._snapValue(this.target.position.x);
            this.target.position.y = this._snapValue(this.target.position.y);
            this.target.position.z = this._snapValue(this.target.position.z);
        }
        if (this.snapEnabled && this.mode === MODE_SCALE) {
            ['x','y','z'].forEach(a => {
                this.target.scale[a] = Math.max(0.01, this._snapValue(this.target.scale[a]));
            });
        }

        if (this.onChange) this.onChange(this.target);
        this.sync();
    }

    _onUp() {
        this._drag = null;
        document.body.style.cursor = '';
        this.dom.style.cursor = '';
    }

    _dragTranslate(e) {
        const d = this._drag;
        const dx = e.clientX - d.startMouse.x;
        const dy = e.clientY - d.startMouse.y;

        const k = this._worldUnitsPerPixel(this.target.position);
        const proj = (dx * d.screenDir.x + dy * d.screenDir.y) * k;

        this.target.position.copy(d.startPosition).addScaledVector(d.axisVec, proj);
    }

    _dragPlane(e) {
        const d = this._drag;
        const cur = this._mousePlaneIntersect(e, d.planeNormal, d.planePoint);
        if (!cur || !d.startPlanePoint) return;

        const delta = new THREE.Vector3().subVectors(cur, d.startPlanePoint);
        this.target.position.copy(d.startPosition).add(delta);
    }

    _dragScale(e) {
        const d = this._drag;
        const dx = e.clientX - d.startMouse.x;
        const dy = e.clientY - d.startMouse.y;
        const proj = (dx * d.screenDir.x + dy * d.screenDir.y) * 0.01;

        const newVal = Math.max(0.05, 1 + proj);
        this.target.scale.copy(d.startScale);
        this.target.scale[d.axis] = d.startScale[d.axis] * newVal;
    }

    _dragRotate(e) {
        const d = this._drag;
        const rect = this.dom.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, this.camera);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            d.planeNormal.clone().applyQuaternion(this.target.quaternion), d.planePoint
        );
        const hit = new THREE.Vector3();
        if (!ray.ray.intersectPlane(plane, hit)) return;

        const ref = new THREE.Vector3();
        const arbitrary = Math.abs(d.planeNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        ref.crossVectors(d.planeNormal, arbitrary).normalize();

        const v = hit.clone().sub(d.planePoint);
        const angle = Math.atan2(
            v.dot(new THREE.Vector3().crossVectors(d.planeNormal, ref)),
            v.dot(ref)
        );

        if (!d.startAngle) {
            d.startAngle = angle;
            d.startRotationEuler = new THREE.Euler().copy(this.target.rotation);
        }

        const delta = angle - d.startAngle;
        const euler = new THREE.Euler().copy(d.startRotationEuler);
        if (d.axis === 'x') euler.x += delta;
        if (d.axis === 'y') euler.y += delta;
        if (d.axis === 'z') euler.z += delta;
        this.target.rotation.copy(euler);
    }

    _snapValue(v) {
        if (!this.snapEnabled || !this.snapSize || this.snapSize <= 0) return v;
        return Math.round(v / this.snapSize) * this.snapSize;
    }

    _mousePlaneIntersect(e, planeNormal, planePoint) {
        const rect = this.dom.getBoundingClientRect();
        const ndc = {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1
        };
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, this.camera);

        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
        const out = new THREE.Vector3();
        if (!ray.ray.intersectPlane(plane, out)) return null;
        return out;
    }

    _projectToScreen(worldVec) {
        const v = worldVec.clone().project(this.camera);
        return new THREE.Vector2(
            (v.x + 1) * 0.5 * this.dom.clientWidth,
            (-v.y + 1) * 0.5 * this.dom.clientHeight
        );
    }

    _worldUnitsPerPixel(refPoint) {
        const dist = this.camera.position.distanceTo(refPoint);
        const fovRad = this.camera.fov * Math.PI / 180;
        return (2 * Math.tan(fovRad / 2) * dist) / this.dom.clientHeight;
    }

    render(renderer) {
        if (!this.enabled || !this.root.visible) return;
        renderer.render(this.scene, this.camera);
    }
}