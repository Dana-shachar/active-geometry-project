import * as THREE from 'three';
import { SHAPE_TYPE_INT } from './shapeManager.js';

// Boolean op → GLSL combination expression.
// 'result' is the running scene SDF, 'dist' is the new shape's SDF.
const BOOLEAN_GLSL = {
    union:     'result = min(result, dist);',
    subtract:  'result = max(result, -dist);',
    intersect: 'result = max(result, dist);',
    exclude:   'result = max(min(result, dist), -max(result, dist));',
};

// ==========================================================
// buildShaderBlock
// Generates the GLSL string that goes between shapeMapper.glsl
// and fragment.glsl in the final concatenated shader.
// Contains: per-shape uniform declarations + the map() function.
// Called by main.js whenever shapeListVersion changes.
// ==========================================================
export function buildShaderBlock(shapeList) {
    const uniformLines = [];
    const mapBodyLines      = ['float map(vec3 worldPos) {',         '    float result = 1e10;'];
    const mapSelectedLines  = ['float mapSelected(vec3 worldPos) {', '    float result = 1e10;'];
    // mapIndex returns the 1-based list index of the union shape whose SDF is closest at worldPos.
    // Used by the picking pass to identify which shape owns a hit pixel.
    const mapIndexLines     = ['int mapIndex(vec3 worldPos) {', '    int bestIndex = 0;', '    float bestDist = 1e10;'];

    for (let shapeIndex = 0; shapeIndex < shapeList.length; shapeIndex++) {
        const prefix = `uShape${shapeIndex}`;

        // Per-shape uniform declarations
        uniformLines.push(
            `uniform int   ${prefix}Type;`,
            `uniform vec3  ${prefix}PosOffset;`,
            `uniform mat3  ${prefix}Rotation;`,
            `uniform float ${prefix}Width;`,
            `uniform float ${prefix}Height;`,
            `uniform float ${prefix}Depth;`,
            `uniform float ${prefix}CornerRadius;`,
            `uniform int   ${prefix}Caps;`,
            `uniform int   ${prefix}Sides;`,
            `uniform int   ${prefix}PolyType;`,
            `uniform float ${prefix}TubeRadius;`,
            `uniform float ${prefix}StepHeight;`,
            `uniform float ${prefix}Turns;`,
            `uniform int   ${prefix}LockProportions;`,
            `uniform int   ${prefix}IsSelected;`,
            `uniform int   ${prefix}ShellEnabled;`,
            `uniform float ${prefix}ShellThickness;`,
        );

        // Shared SDF call snippet reused in both map() and mapSelected()
        const sdfCall = [
            `        vec3 localPos = ${prefix}Rotation * (worldPos - ${prefix}PosOffset);`,
            `        float dist = shapeMapper(${prefix}Type, localPos, ${prefix}Width, ${prefix}Height,`,
            `            ${prefix}Depth, ${prefix}CornerRadius, ${prefix}Caps, ${prefix}Sides,`,
            `            ${prefix}PolyType, ${prefix}TubeRadius, ${prefix}StepHeight, ${prefix}Turns,`,
            `            ${prefix}LockProportions);`,
            `        if (${prefix}ShellEnabled == 1) dist = max(dist, -(dist + ${prefix}ShellThickness));`,
        ];

        // Per-shape block inside map() — uses baked boolean op
        const boolOp = shapeList[shapeIndex].booleanOp;
        const combineGlsl = BOOLEAN_GLSL[boolOp] ?? BOOLEAN_GLSL.union;
        mapBodyLines.push(`    {`, ...sdfCall, `        ${combineGlsl}`, `    }`);

        // Per-shape block inside mapSelected() — unions only selected shapes at runtime
        mapSelectedLines.push(
            `    if (${prefix}IsSelected == 1) {`,
            ...sdfCall,
            `        result = min(result, dist);`,
            `    }`,
        );

        // All shapes are pickable. abs(dist) picks the shape whose surface is geometrically
        // closest to the hit point — correctly handles subtract shapes whose SDF is negative
        // inside the base solid (negative would always win with a plain < comparison).
        mapIndexLines.push(
            `    {`,
            ...sdfCall,
            `        if (abs(dist) < abs(bestDist)) { bestDist = dist; bestIndex = ${shapeIndex + 1}; }`,
            `    }`,
        );
    }

    mapBodyLines.push('    return result;', '}');
    mapSelectedLines.push('    return result;', '}');
    mapIndexLines.push('    return bestIndex;', '}');

    return uniformLines.join('\n') + '\n\n'
         + mapBodyLines.join('\n')     + '\n\n'
         + mapSelectedLines.join('\n') + '\n\n'
         + mapIndexLines.join('\n')    + '\n';
}

// ==========================================================
// buildUniforms
// Returns a Three.js uniforms object covering every per-shape
// uniform declared by buildShaderBlock, plus the two scene-level
// uniforms (uIsSelected, uActiveShapePosOffset) used for selection outline.
// main.js merges this with the camera/lighting uniforms.
// ==========================================================
export function buildUniforms(shapeList) {
    const uniforms = {
        uIsSelected:           { value: 0 },
        uSelectedIsNonUnion:   { value: 0 },
        uActiveShapePosOffset: { value: new THREE.Vector3() },
        uClipAxis:             { value: 0 },
        uClipPos:              { value: 0 },
    };

    for (let shapeIndex = 0; shapeIndex < shapeList.length; shapeIndex++) {
        const shape  = shapeList[shapeIndex];
        const prefix = `uShape${shapeIndex}`;

        uniforms[`${prefix}Type`]            = { value: SHAPE_TYPE_INT[shape.type] ?? 0 };
        uniforms[`${prefix}PosOffset`]       = { value: shape.posOffset.clone() };
        uniforms[`${prefix}Rotation`]        = { value: new THREE.Matrix3() };
        uniforms[`${prefix}Width`]           = { value: shape.width };
        uniforms[`${prefix}Height`]          = { value: shape.height };
        uniforms[`${prefix}Depth`]           = { value: shape.depth };
        uniforms[`${prefix}CornerRadius`]    = { value: shape.cornerRadius };
        uniforms[`${prefix}Caps`]            = { value: shape.caps ? 1 : 0 };
        uniforms[`${prefix}Sides`]           = { value: shape.sides };
        uniforms[`${prefix}PolyType`]        = { value: shape.polyType };
        uniforms[`${prefix}TubeRadius`]      = { value: shape.tubeRadius };
        uniforms[`${prefix}StepHeight`]      = { value: shape.stepHeight };
        uniforms[`${prefix}Turns`]           = { value: shape.turns };
        uniforms[`${prefix}LockProportions`] = { value: shape.lockProportions ? 1 : 0 };
        uniforms[`${prefix}IsSelected`]      = { value: 0 };
        uniforms[`${prefix}ShellEnabled`]    = { value: shape.shellEnabled  ? 1 : 0 };
        uniforms[`${prefix}ShellThickness`]  = { value: shape.shellThickness };
    }

    return uniforms;
}

// ==========================================================
// syncShapeUniforms
// Called every frame from main.js animate() to push current
// shape param values to the GPU. Does NOT recompile the shader.
// ==========================================================
export function syncShapeUniforms(shapeList, materialUniforms, activeShapeIndex, _rotMat4, selectedShapeIds) {
    for (let shapeIndex = 0; shapeIndex < shapeList.length; shapeIndex++) {
        const shape  = shapeList[shapeIndex];
        const prefix = `uShape${shapeIndex}`;

        materialUniforms[`${prefix}Type`].value            = SHAPE_TYPE_INT[shape.type] ?? 0;
        materialUniforms[`${prefix}PosOffset`].value.copy(shape.posOffset);
        materialUniforms[`${prefix}Width`].value           = shape.width;
        materialUniforms[`${prefix}Height`].value          = shape.height;
        materialUniforms[`${prefix}Depth`].value           = shape.depth;
        materialUniforms[`${prefix}CornerRadius`].value    = shape.cornerRadius;
        materialUniforms[`${prefix}Caps`].value            = shape.caps ? 1 : 0;
        materialUniforms[`${prefix}Sides`].value           = shape.sides;
        materialUniforms[`${prefix}PolyType`].value        = shape.polyType;
        materialUniforms[`${prefix}TubeRadius`].value      = shape.tubeRadius;
        materialUniforms[`${prefix}StepHeight`].value      = shape.stepHeight;
        materialUniforms[`${prefix}Turns`].value           = shape.turns;
        materialUniforms[`${prefix}LockProportions`].value = shape.lockProportions ? 1 : 0;
        materialUniforms[`${prefix}IsSelected`].value      = selectedShapeIds?.has(shape.id) ? 1 : 0;
        materialUniforms[`${prefix}ShellEnabled`].value    = shape.shellEnabled  ? 1 : 0;
        materialUniforms[`${prefix}ShellThickness`].value  = shape.shellThickness;

        // Sync rotation matrix: store inverse (transpose) so shader can apply it directly
        _rotMat4.makeRotationFromEuler(shape.rotation);
        materialUniforms[`${prefix}Rotation`].value.setFromMatrix4(_rotMat4).transpose();
    }

    // Update scene-level selection uniforms to reflect the active shape
    const activeShape = shapeList[activeShapeIndex];
    if (activeShape) {
        materialUniforms.uActiveShapePosOffset.value.copy(activeShape.posOffset);
    }
}
