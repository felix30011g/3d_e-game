import * as THREE from 'three';

export class PropertiesPanel {
    constructor() {
        this.panel = document.getElementById('inspector');
        this.title = document.getElementById('insp-title');
        this.body  = document.querySelector('.insp-body');
        this.colorInput = document.getElementById('insp-color');

        this.current = null;
        this.onChange = null;
        this.onDelete = null;
        this.onDuplicate = null;
        this.onClose = null;

        this._inputs = {
            position: this._rowInputs('position'),
            rotation: this._rowInputs('rotation'),
            scale:    this._rowInputs('scale')
        };

        // Свет
        this.lightSection      = document.getElementById('insp-light-section');
        this.lightColorRow     = document.getElementById('insp-light-color-row');
        this.lightIntensityRow = document.getElementById('insp-light-intensity-row');
        this.lightDistanceRow  = document.getElementById('insp-light-distance-row');
        this.lightShadowRow    = document.getElementById('insp-light-shadow-row');

        this.lightColor        = document.getElementById('insp-light-color');
        this.lightIntensity    = document.getElementById('insp-light-intensity');
        this.lightIntensityVal = document.getElementById('insp-light-intensity-val');
        this.lightDistance     = document.getElementById('insp-light-distance');
        this.lightCastShadow   = document.getElementById('insp-light-castshadow');

        this._bind();
        this._bindLightInputs();
        this.setTarget(null);
    }

    _rowInputs(prop) {
        const row = this.panel.querySelector(`.insp-row[data-prop="${prop}"]`);
        return {
            x: row.querySelector('input[data-axis="x"]'),
            y: row.querySelector('input[data-axis="y"]'),
            z: row.querySelector('input[data-axis="z"]')
        };
    }

    _bind() {
        for (const prop of ['position', 'rotation', 'scale']) {
            for (const axis of ['x', 'y', 'z']) {
                const input = this._inputs[prop][axis];
                input.addEventListener('input', () => {
                    if (!this.current) return;
                    const val = parseFloat(input.value);
                    if (isNaN(val)) return;

                    if (prop === 'position') {
                        this.current.position[axis] = val;
                    } else if (prop === 'scale') {
                        const v = Math.max(0.01, val);
                        this.current.scale[axis] = v;
                    } else if (prop === 'rotation') {
                        this.current.rotation[axis] = THREE.MathUtils.degToRad(val);
                    }

                    if (this.onChange) this.onChange(this.current);
                });

                input.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.code === 'Enter') input.blur();
                });
            }
        }

        this.colorInput.addEventListener('input', () => {
            if (!this.current || !this.current.material) return;
            this.current.material.color.set(this.colorInput.value);
            if (this.onChange) this.onChange(this.current);
        });

        document.getElementById('insp-delete').addEventListener('click', () => {
            if (this.onDelete) this.onDelete();
        });
        document.getElementById('insp-duplicate').addEventListener('click', () => {
            if (this.onDuplicate) this.onDuplicate();
        });
        document.getElementById('insp-close').addEventListener('click', () => {
            if (this.onClose) this.onClose();
        });
    }

    _bindLightInputs() {
        this.lightColor.addEventListener('input', () => {
            if (!this.current?.userData.isLightObject) return;
            this.current.setColor(this.lightColor.value);
            if (this.onChange) this.onChange(this.current);
        });
        this.lightIntensity.addEventListener('input', () => {
            if (!this.current?.userData.isLightObject) return;
            const v = parseFloat(this.lightIntensity.value);
            this.current.setIntensity(v);
            this.lightIntensityVal.textContent = v.toFixed(1);
            if (this.onChange) this.onChange(this.current);
        });
        this.lightDistance.addEventListener('input', () => {
            if (!this.current?.userData.isLightObject) return;
            this.current.setDistance(parseFloat(this.lightDistance.value));
            if (this.onChange) this.onChange(this.current);
        });
        this.lightCastShadow.addEventListener('change', () => {
            if (!this.current?.userData.isLightObject) return;
            this.current.setShadowEnabled(this.lightCastShadow.checked);
        });

        // Не пробрасывать клавиши в редактор при фокусе в полях света
        [this.lightDistance, this.lightIntensity].forEach(el => {
            el.addEventListener('keydown', e => e.stopPropagation());
        });
    }

    setTarget(obj) {
        this.current = obj;

        const isLight = !!obj?.userData?.isLightObject;
        const disp = isLight ? '' : 'none';
        this.lightSection.style.display      = disp;
        this.lightColorRow.style.display     = disp;
        this.lightIntensityRow.style.display = disp;
        this.lightDistanceRow.style.display  = disp;
        this.lightShadowRow.style.display    = disp;

        if (!obj) {
            this.title.textContent = 'Ничего не выбрано';
            this.body.classList.add('disabled');
            return;
        }

        this.body.classList.remove('disabled');
        this.title.textContent = obj.userData.name || obj.geometry?.type || 'Объект';

        this.syncFrom(obj);
    }

    syncFrom(obj) {
        if (!obj || obj !== this.current) return;

        this._inputs.position.x.value = obj.position.x.toFixed(3);
        this._inputs.position.y.value = obj.position.y.toFixed(3);
        this._inputs.position.z.value = obj.position.z.toFixed(3);

        this._inputs.rotation.x.value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
        this._inputs.rotation.y.value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
        this._inputs.rotation.z.value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);

        this._inputs.scale.x.value = obj.scale.x.toFixed(3);
        this._inputs.scale.y.value = obj.scale.y.toFixed(3);
        this._inputs.scale.z.value = obj.scale.z.toFixed(3);

        if (obj.material && obj.material.color) {
            this.colorInput.value = '#' + obj.material.color.getHexString();
        }

        if (obj.userData.isLightObject) {
            this.lightColor.value = '#' + obj.light.color.getHexString();
            this.lightIntensity.value = obj.light.intensity;
            this.lightIntensityVal.textContent = obj.light.intensity.toFixed(1);
            this.lightDistance.value = obj.light.distance;
            this.lightCastShadow.checked = obj.light.castShadow;
        }
    }
}