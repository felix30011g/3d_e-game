import * as THREE from 'three';

export class LightObject extends THREE.Group {
    constructor(options = {}) {
        super();

        this.userData.isLightObject = true;
        this.userData.name = options.name || 'Свет';

        this.light = new THREE.PointLight(
            options.color ?? 0xffddaa,
            options.intensity ?? 2,
            options.distance ?? 15,
            options.decay ?? 2
        );
        this.light.castShadow = options.castShadow ?? true;
        if (this.light.castShadow) {
            this.light.shadow.mapSize.set(1024, 1024);
            this.light.shadow.camera.near = 0.5;
            this.light.shadow.camera.far = 50;
            this.light.shadow.bias = -0.0005;
        }
        this.add(this.light);

        this.iconMat = new THREE.MeshBasicMaterial({
            color: this.light.color.getHex(),
            transparent: true,
            opacity: 0.9
        });
        this.icon = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 16, 12),
            this.iconMat
        );
        this.add(this.icon);

        this.hitbox = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 8, 6),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        this.hitbox.userData.isLightHitbox = true;
        this.hitbox.userData.lightObject = this;
        this.add(this.hitbox);

        this.glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 16, 12),
            new THREE.MeshBasicMaterial({
                color: this.light.color.getHex(),
                transparent: true,
                opacity: 0.15,
                depthWrite: false
            })
        );
        this.add(this.glow);

        this.position.set(
            options.x ?? 0,
            options.y ?? 3,
            options.z ?? 0
        );
    }

    setColor(hex) {
        this.light.color.set(hex);
        this.iconMat.color.set(hex);
        this.glow.material.color.set(hex);
    }

    setIntensity(v) {
        this.light.intensity = v;
    }

    setDistance(v) {
        this.light.distance = v;
    }

    setShadowEnabled(enabled) {
        this.light.castShadow = enabled;
    }
}

export class Lighting {
    constructor(scene) {
        this.scene = scene;

        this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(this.ambient);

        this.sun = new THREE.DirectionalLight(0xfff0d0, 1.2);
        this.sun.position.set(50, 80, 30);
        this.sun.castShadow = true;
        this._setupSunShadow(2048);
        this.scene.add(this.sun);

        this.hemi = new THREE.HemisphereLight(0x8fc9ff, 0x3a2d1f, 0.5);
        this.scene.add(this.hemi);

        this.lightObjects = [];
    }

    _setupSunShadow(resolution) {
        this.sun.shadow.mapSize.set(resolution, resolution);
        const s = 120;
        this.sun.shadow.camera.left   = -s;
        this.sun.shadow.camera.right  =  s;
        this.sun.shadow.camera.top    =  s;
        this.sun.shadow.camera.bottom = -s;
        this.sun.shadow.camera.near   = 1;
        this.sun.shadow.camera.far    = 300;
        if (this.sun.shadow.map) {
            this.sun.shadow.map.dispose();
            this.sun.shadow.map = null;
        }
    }

    setAmbient(color, intensity) {
        if (color !== undefined && color !== null) this.ambient.color.set(color);
        if (typeof intensity === 'number') this.ambient.intensity = intensity;
    }

    setSun(color, intensity, position) {
        if (color !== undefined && color !== null) this.sun.color.set(color);
        if (typeof intensity === 'number') this.sun.intensity = intensity;
        if (position && typeof position.x === 'number') {
            this.sun.position.set(position.x, position.y, position.z);
        }
    }

    setHemisphere(skyColor, groundColor, intensity) {
        if (skyColor !== undefined && skyColor !== null) this.hemi.color.set(skyColor);
        if (groundColor !== undefined && groundColor !== null) this.hemi.groundColor.set(groundColor);
        if (typeof intensity === 'number') this.hemi.intensity = intensity;
    }

    setShadowResolution(res) {
        this._setupSunShadow(res);
    }

    setShadowsEnabled(enabled) {
        this.sun.castShadow = enabled;
    }

    createLight(options) {
        const lightObj = new LightObject(options);
        this.scene.add(lightObj);
        this.lightObjects.push(lightObj);
        return lightObj;
    }

    removeLight(lightObj) {
        const i = this.lightObjects.indexOf(lightObj);
        if (i >= 0) this.lightObjects.splice(i, 1);
        lightObj.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        this.scene.remove(lightObj);
    }
}