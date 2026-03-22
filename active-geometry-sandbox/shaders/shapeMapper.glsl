// SHAPE MAPPER
// Static dispatch: takes shape type + all params as arguments, returns SDF distance.
// Called once per shape per ray march step by the generated map() function.
// shapeType integers match SHAPE_TYPE_INT in shapeManager.js:
//   0 = sphere / ellipsoid   1 = box   2 = cylinder
//   4 = prism   5 = polyhedron   6 = helix

// ==========================================================
// SCENE-LEVEL UNIFORMS
// These represent the active/selected shape — used by fragment.glsl
// for the selection outline. Updated to the active shape's values each frame.
// ==========================================================
uniform int  uIsSelected;
uniform vec3 uActiveShapePosOffset;

// ==========================================================
// DISPATCH
// ==========================================================
float shapeMapper(
    int   shapeType,
    vec3  localPos,
    float width,
    float height,
    float depth,
    float cornerRadius,
    int   caps,
    int   sides,
    int   polyType,
    float tubeRadius,
    float stepHeight,
    float turns,
    int   lockProportions   // 1 = locked (sphere), 0 = unlocked (ellipsoid)
) {
    if (shapeType == 0) {
        // Sphere when proportions are locked, ellipsoid when unlocked.
        if (lockProportions == 1) return sdSphere(localPos, width);
        return sdEllipsoid(localPos, vec3(width, height, width));
    }
    if (shapeType == 1) {
        vec3 halfExtents = vec3(width, height, depth);
        if (cornerRadius > 0.0) return sdRoundBox(localPos, halfExtents, cornerRadius);
        return sdBox(localPos, halfExtents);
    }
    if (shapeType == 2) {
        if (caps == 0)            return sdOpenCylinder(localPos, height, width);
        if (cornerRadius > 0.0)   return sdRoundCyl(localPos, width, cornerRadius, height);
        return sdCylinder(localPos, height, width);
    }
    if (shapeType == 4) {
        if (caps == 0) {
            float priDist2D    = sdPolygon2D(localPos.xz, width, sides);
            float priDistAxial = abs(localPos.y) - height;
            if (priDistAxial > 0.0) return length(vec2(max(priDist2D, 0.0), priDistAxial));
            return priDist2D;
        }
        return sdNgonPrism(localPos, width, height, sides);
    }
    if (shapeType == 5) {
        if (polyType == 0) return sdTetrahedron(localPos, width);
        if (polyType == 1) return sdOctahedron(localPos, width);
        if (polyType == 2) return sdIcosahedron(localPos, width);
        if (polyType == 3) return sdDodecahedron(localPos, width);
        return 1e10;
    }
    if (shapeType == 6) return sdHelix(localPos, width, tubeRadius, stepHeight, turns);
    return 1e10;
}
