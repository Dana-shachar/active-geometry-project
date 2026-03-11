// SDF MANAGER FILE

// ==========================================================
// CONSTANTS
// ==========================================================
#define PI 3.14159265359

// ==========================================================
// UNIFORMS & HELPERS
// ==========================================================
uniform int   uShapeType;
uniform float uWidth;
uniform float uHeight;
uniform float uDepth;         // box Z half-extent (independent from width)
uniform float uCornerRadius;  // rounding: box edges, or cylinder cap hemisphere radius
uniform int   uCaps;          // 1 = caps on (default), 0 = open ends
uniform int   uPrismSides;    // N-gon prism: number of polygon sides (3–20)
uniform int   uPolyType;      // polyhedron sub-type: 0=Tetrahedron, 1=Octahedron, 2=Icosahedron, 3=Dodecahedron
uniform float uTubeRadius;   // helix: wire cross-section radius
uniform float uStepHeight;   // helix: axial rise per full turn
uniform float uTurns;        // helix: number of turns (controls total height)
uniform vec3  uPosOffset;
uniform int   uIsSelected;



// ==========================================================
// SDF SHAPE LIBRARY
// ==========================================================

// Sphere: Checks length from center minus the size
float sdSphere(vec3 ptPos, float sphSize) {
  return length(ptPos) - sphSize;
}

// Box: Calculates distance using box-specific offsets
float sdBox(vec3 ptPos, vec3 boxSize) {
  vec3 boxOffset  = abs(ptPos) - boxSize;
  float boxExDist = length(max(boxOffset, 0.0));
  float boxInDist = min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  return boxExDist + boxInDist;
}

// Rounded Box: sdBox with edges/corners carved to a given radius.
// halfExtents are the outer bounds — rounding is inset from them.
float sdRoundBox(vec3 ptPos, vec3 halfExtents, float radius) {
  float boxRadius = min(radius, min(halfExtents.x, min(halfExtents.y, halfExtents.z)));
  vec3 boxOffset  = abs(ptPos) - halfExtents + boxRadius;
  return length(max(boxOffset, 0.0)) + min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0) - boxRadius;
}

// Ellipsoid: Non-uniform sphere scaled independently per axis
float sdEllipsoid(vec3 ptPos, vec3 ellipRadii) {
    float k0 = length(ptPos / ellipRadii);
    float k1 = length(ptPos / (ellipRadii * ellipRadii));
    return k0 * (k0 - 1.0) / k1;
}

// Cylinder: Uses cylinder-specific components and distances
float sdCylinder(vec3 ptPos, float cylHeight, float cylRadius) {
  vec2 cylComp    = abs(vec2(length(ptPos.xz), ptPos.y)) - vec2(cylRadius, cylHeight);
  float cylExDist = length(max(cylComp, 0.0));
  float cylInDist = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDist + cylInDist;
}

// Rounded Cylinder: cylinder with filleted cap edges.
// cornerRadius = 0 → flat caps (identical to sdCylinder); cornerRadius = cylRadius → full capsule.
// Outer dimensions stay at cylRadius × cylHeight regardless of rounding.
float sdRoundCyl(vec3 ptPos, float cylRadius, float cornerRadius, float cylHeight) {
  float cylRoundRadius = min(cornerRadius, min(cylRadius, cylHeight)); // clamp to shape limits
  vec2 cylComp    = abs(vec2(length(ptPos.xz), ptPos.y)) - vec2(cylRadius - cylRoundRadius, cylHeight - cylRoundRadius);
  float cylExDist = length(max(cylComp, 0.0));
  float cylInDist = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDist + cylInDist - cylRoundRadius;
}

// Open Cylinder: lateral surface only, no flat end caps.
float sdOpenCylinder(vec3 ptPos, float cylHeight, float cylRadius) {
  float cylRadial = length(ptPos.xz) - cylRadius;
  float cylAxial  = abs(ptPos.y) - cylHeight;
  // Outside height range: guide ray to nearest rim — no flat cap surface
  if (cylAxial > 0.0) return length(vec2(max(cylRadial, 0.0), cylAxial));
  return cylRadial;
}

// Tetrahedron: 4 equilateral faces, normals along cube diagonals.
// polyCircumRad = center-to-vertex distance.
float sdTetrahedron(vec3 tetPtPos, float tetCircumRad) {
    float tetFaceOffset = tetCircumRad / sqrt(3.0);                       // center-to-face distance
    float tetDist = max(max(                                               // max over all 4 face half-spaces
         tetPtPos.x + tetPtPos.y + tetPtPos.z,
        -tetPtPos.x - tetPtPos.y + tetPtPos.z),
        max(
        -tetPtPos.x + tetPtPos.y - tetPtPos.z,
         tetPtPos.x - tetPtPos.y - tetPtPos.z));
    return (tetDist - tetFaceOffset * sqrt(3.0)) / sqrt(3.0);            // normalize by face normal length
}

// Octahedron: 8 equilateral faces. polyCircumRad = center-to-vertex distance.
// IQ exact formula: folds all 8 octants onto one, then solves analytically.
float sdOctahedron(vec3 octPtPos, float octCircumRad) {
    vec3  octAbsPos   = abs(octPtPos);                                                  // fold into positive octant
    float octFaceDist = octAbsPos.x + octAbsPos.y + octAbsPos.z - octCircumRad;        // signed dist to face plane (x+y+z=R)
    vec3  octArea;
    if      (3.0 * octAbsPos.x < octFaceDist) octArea = octAbsPos.xyz;                 // permute coords to work relative to nearest edge region
    else if (3.0 * octAbsPos.y < octFaceDist) octArea = octAbsPos.yzx;
    else if (3.0 * octAbsPos.z < octFaceDist) octArea = octAbsPos.zxy;
    else return octFaceDist * 0.57735027;                                               // inside shape: face distance is exact (÷√3 to normalize)
    float octEdge = clamp(0.5 * (octArea.z - octArea.y + octCircumRad), 0.0, octCircumRad); // projection along nearest edge
    return length(vec3(octArea.x, octArea.y - octCircumRad + octEdge, octArea.z - octEdge)); // dist to closest point on that edge
}

// Icosahedron: 20 equilateral faces. polyCircumRad = center-to-vertex distance.
// abs-fold reduces 20 face checks to 4: 8 cube-diagonal normals → 1 check,
// 4 golden normals per axis plane (XZ, XY, YZ) → 3 checks.
float sdIcosahedron(vec3 polyPtPos, float polyCircumRad) {
    float icosGoldenRatio = (1.0 + sqrt(5.0)) * 0.5;                                                              // φ ≈ 1.618 — icosahedron geometry is built from this
    float icosInrad       = polyCircumRad * (1.0 + icosGoldenRatio) / (sqrt(3.0) * sqrt(2.0 + icosGoldenRatio)); // center-to-face distance, derived from circumradius
    vec3  icosAbsPos      = abs(polyPtPos);                                                                        // fold into positive octant — exploits inversion symmetry
    float icosCubeFaces   = dot(icosAbsPos, vec3(1.0, 1.0, 1.0)) / sqrt(3.0);                                     // covers all 8 cube-diagonal face normals at once
    float icosGoldXZ      = dot(icosAbsPos, vec3(1.0/icosGoldenRatio, 0.0, icosGoldenRatio)) / sqrt(3.0);         // covers 4 golden-rectangle face normals in the XZ plane
    float icosGoldXY      = dot(icosAbsPos, vec3(icosGoldenRatio, 1.0/icosGoldenRatio, 0.0)) / sqrt(3.0);         // covers 4 golden-rectangle face normals in the XY plane
    float icosGoldYZ      = dot(icosAbsPos, vec3(0.0, icosGoldenRatio, 1.0/icosGoldenRatio)) / sqrt(3.0);         // covers 4 golden-rectangle face normals in the YZ plane
    return max(max(icosCubeFaces, icosGoldXZ), max(icosGoldXY, icosGoldYZ)) - icosInrad;                          // furthest face plane determines the SDF
}

// Dodecahedron: 12 pentagonal faces, dual of icosahedron.
// Face normals = icosahedron vertex directions = cyclic perms of (0,±1,±φ)/√(2+φ).
// abs-fold collapses all 12 normals into 3 checks (one per axis-plane pair).
float sdDodecahedron(vec3 polyPtPos, float polyCircumRad) {
    float dodGoldenRatio = (1.0 + sqrt(5.0)) * 0.5;                                                             // φ ≈ 1.618
    float dodInrad       = polyCircumRad * (1.0 + dodGoldenRatio) / (sqrt(3.0) * sqrt(2.0 + dodGoldenRatio));   // center-to-face distance
    vec3  dodAbsPos      = abs(polyPtPos);                                                                        // fold into positive octant
    float dodFaceYZ      = dot(dodAbsPos, vec3(0.0, 1.0, dodGoldenRatio)) / sqrt(2.0 + dodGoldenRatio);         // normals in YZ plane: (0,±1,±φ)/√(2+φ)
    float dodFaceXZ      = dot(dodAbsPos, vec3(dodGoldenRatio, 0.0, 1.0)) / sqrt(2.0 + dodGoldenRatio);         // normals in XZ plane: (±φ,0,±1)/√(2+φ)
    float dodFaceXY      = dot(dodAbsPos, vec3(1.0, dodGoldenRatio, 0.0)) / sqrt(2.0 + dodGoldenRatio);         // normals in XY plane: (±1,±φ,0)/√(2+φ)
    return max(max(dodFaceYZ, dodFaceXZ), dodFaceXY) - dodInrad;
}

// Helix: tube wound around Y axis. Adapted from IQ shadertoy.com/view/ftyBRd
// helCoilRad = axis-to-centerline radius. helTubeRad = wire cross-section radius.
// helStepHeight = axial rise per full turn. helTurns = number of turns (finite length).
// NOTE: approximate SDF — valid when tubeRad < stepHeight / 2 (coils not overlapping).
// Shader-side clamps enforce this even if UI sliders go out of range.
float sdHelix(vec3 helPtPos, float helCoilRad, float helTubeRad, float helStepHeight, float helTurns) {
    // Enforce geometric stability: clamp params to valid range before any math.
    helStepHeight = min(helStepHeight, helCoilRad * 2.5);
    helTubeRad    = min(helTubeRad,    helStepHeight * 0.48);

    vec2  helLine     = vec2(helStepHeight, 6.283185 * helCoilRad);
    vec2  helLineDir  = vec2(helLine.y, -helLine.x);
    float helPeriod   = helLine.x * helLine.y;
    float helLineSq   = dot(helLine, helLine);

    vec2  helMapPt    = vec2(helPtPos.y, helCoilRad * atan(helPtPos.x, helPtPos.z));
    vec2  helUnwrapPt = vec2(dot(helMapPt, helLineDir), dot(helMapPt, helLine));

    // round() is seam-safe. Check 3 candidates covers all Voronoi boundaries.
    float coilNearest = round(helUnwrapPt.x / helPeriod);

    vec2  centerA = (helLine * helUnwrapPt.y + helLineDir * (coilNearest - 1.0) * helPeriod) / helLineSq;
    centerA.y    /= helCoilRad;
    vec3  wrapA   = vec3(sin(centerA.y) * helCoilRad, centerA.x, cos(centerA.y) * helCoilRad);

    vec2  centerB = (helLine * helUnwrapPt.y + helLineDir * coilNearest * helPeriod) / helLineSq;
    centerB.y    /= helCoilRad;
    vec3  wrapB   = vec3(sin(centerB.y) * helCoilRad, centerB.x, cos(centerB.y) * helCoilRad);

    vec2  centerC = (helLine * helUnwrapPt.y + helLineDir * (coilNearest + 1.0) * helPeriod) / helLineSq;
    centerC.y    /= helCoilRad;
    vec3  wrapC   = vec3(sin(centerC.y) * helCoilRad, centerC.x, cos(centerC.y) * helCoilRad);

    float infDist       = min(min(length(helPtPos - wrapA), length(helPtPos - wrapB)), length(helPtPos - wrapC)) - helTubeRad;

    float helHalfHeight = helTurns * helStepHeight * 0.5;
    return max(infDist, abs(helPtPos.y) - helHalfHeight);
}

// N-gon Prism: 2D signed distance to a regular polygon in the XZ plane.
// Uses IQ's symmetry-fold: maps any point into a canonical sector, then tests one edge.
// priCircumRad = distance from center to vertex. priSideCount >= 3.
float sdPolygon2D(vec2 priRadialPos, float priCircumRad, int priSideCount) {
    float priHalfAngle   = PI / float(priSideCount);           // half the angle of one sector
    vec2  priEdgeCossin  = vec2(cos(priHalfAngle), sin(priHalfAngle)); // direction toward edge midpoint
    float priSectorAngle = mod(atan(priRadialPos.y, priRadialPos.x), 2.0 * priHalfAngle) - priHalfAngle; // fold into canonical sector
    // abs(sin()) mirrors the bottom half of the sector onto the top half. 
    // This allows us to calculate the distance to just ONE half of ONE edge segment, 
    // rather than looping through all N sides of the polygon.
    vec2  priFoldedPos = length(priRadialPos) * vec2(cos(priSectorAngle), abs(sin(priSectorAngle)));          
          priFoldedPos   -= priCircumRad * priEdgeCossin;        // shift origin to edge midpoint
          priFoldedPos.y += clamp(-priFoldedPos.y, 0.0, priCircumRad * priEdgeCossin.y); // clamp to edge length
    return length(priFoldedPos) * sign(priFoldedPos.x);        // signed: negative inside, positive outside
}

// N-gon Prism: extruded regular polygon, capped ends.
float sdNgonPrism(vec3 ptPos, float priCircumRad, float priHalfHeight, int priSideCount) {
    float priDist2D    = sdPolygon2D(ptPos.xz, priCircumRad, priSideCount); // 2D polygon distance in XZ
    float priDistAxial = abs(ptPos.y) - priHalfHeight;                      // signed distance from cap plane
    return length(max(vec2(priDist2D, priDistAxial), 0.0)) + min(max(priDist2D, priDistAxial), 0.0);
}

// ==========================================================
// 1. RAW GEOMETRY (shapeMap)
// ==========================================================
float shapeMap(vec3 localPos) {
    if (uShapeType == 0) return sdSphere(localPos, uWidth);
    if (uShapeType == 1) {
        vec3 halfExtents = vec3(uWidth, uHeight, uDepth);
        if (uCornerRadius > 0.0) return sdRoundBox(localPos, halfExtents, uCornerRadius);
        return sdBox(localPos, halfExtents);
    }
    if (uShapeType == 2) {
        if (uCaps == 0)           return sdOpenCylinder(localPos, uHeight, uWidth);
        if (uCornerRadius > 0.0)  return sdRoundCyl(localPos, uWidth, uCornerRadius, uHeight);
        return sdCylinder(localPos, uHeight, uWidth);
    }
    if (uShapeType == 3) return sdEllipsoid(localPos, vec3(uWidth, uHeight, uWidth));
    if (uShapeType == 4) {
        if (uCaps == 0) {
            // Open ends: lateral faces only, no flat caps
            float priDist2D    = sdPolygon2D(localPos.xz, uWidth, uPrismSides);
            float priDistAxial = abs(localPos.y) - uHeight;
            if (priDistAxial > 0.0) return length(vec2(max(priDist2D, 0.0), priDistAxial)); // outside height: guide to rim
            return priDist2D;
        }
        return sdNgonPrism(localPos, uWidth, uHeight, uPrismSides);
    }
    if (uShapeType == 5) {
        if (uPolyType == 0) return sdTetrahedron(localPos, uWidth);
        if (uPolyType == 1) return sdOctahedron(localPos, uWidth);
        if (uPolyType == 2) return sdIcosahedron(localPos, uWidth);
        if (uPolyType == 3) return sdDodecahedron(localPos, uWidth);
        return 1e10;
    }
    if (uShapeType == 6) return sdHelix(localPos, uWidth, uTubeRadius, uStepHeight, uTurns);
    return 1e10; // unknown shape: return nothing
}

// ==========================================================
// 2. PROBE (getShapeBBox)
// ==========================================================
vec3 getShapeBBox() {
    // Returns conservative half-extents. In Stage 2 (booleans),
    // this will return the union of both shapes' bounding boxes.
    if (uShapeType == 0) return vec3(uWidth, uWidth, uWidth);
    if (uShapeType == 1) return vec3(uWidth, uHeight, uDepth);
    if (uShapeType == 2) return vec3(uWidth, uHeight, uWidth); // sdRoundCyl keeps same outer dims as sdCylinder
    if (uShapeType == 4) return vec3(uWidth, uHeight, uWidth); // polygon fits inside circumscribed cylinder
    if (uShapeType == 5) return vec3(uWidth, uWidth, uWidth);  // polyhedron fits inside circumscribed sphere
    if (uShapeType == 6) return vec3(uWidth + uTubeRadius, uTurns * uStepHeight * 0.5 + uTubeRadius, uWidth + uTubeRadius); // helix: coilRad+tubeRad laterally, half total height + tubeRad axially
    return vec3(uWidth, uHeight, uWidth);
}

// ==========================================================
// 3. SCENE ASSEMBLER (map)
// ==========================================================
float map(vec3 worldPos) {
    vec3 localPos = worldPos - uPosOffset;
    return shapeMap(localPos);
}
