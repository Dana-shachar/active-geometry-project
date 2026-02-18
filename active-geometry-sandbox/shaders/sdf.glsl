// SDF MANAGER FILE

// local shape uniforms
uniform int uShapeType;
uniform float uWidth;
uniform float uHeight;
uniform vec3 uPosOffset; // to track the positional offset for moving shapes from js


// ==========================================================
// SDF SHAPE LIBRARY
// ==========================================================

// Sphere: Checks length from center minus the size
float sdSphere(vec3 pos, float sphSize) {
  return length(pos) - sphSize;
}

// Box: Calculates distance using box-specific offsets
float sdBox(vec3 pos, vec3 boxSize) {
  // boxOffset measures how far we are from the box edges in each direction
  vec3 boxOffset = abs(pos) - boxSize;
  float boxExDis = length(max(boxOffset, 0.0));
  float boxInDis = min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  return boxExDis + boxInDis;
}

// Cylinder: Uses cylinder-specific components and distances
float sdCylinder(vec3 pos, float cylHeight, float cylRadius) {
  // cylComp handles the 2D projected distance
  vec2 cylComp = abs(vec2(length(pos.xz), pos.y)) - vec2(cylRadius, cylHeight);

  // cylExDis is the distance outside, cylInDis is the distance inside (negative)
  float cylExDis = length(max(cylComp, 0.0));
  float cylInDis = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDis + cylInDis;
}

// ==========================================================
// THE SCENE MAP (The "Switchboard")
// ==========================================================
float map(vec3 pos) {
  // 1. DOMAIN PUSHING: Subtract the mouse offset from the incoming position
  // This makes the object "move" with your drag.
  vec3 movedPos = pos - uPosOffset;

  float rayDis = 0.0;

  // 2. CHOOSE THE SHAPE
  if (uShapeType == 0) {
      rayDis = sdSphere(movedPos, uWidth);
  } else if (uShapeType == 1) {
      rayDis = sdBox(movedPos, vec3(uWidth, uHeight, uWidth));
  } else {
      rayDis = sdCylinder(movedPos, uHeight, uWidth);
  }

  // 3. THE UNIT CELL BOUNDARY (Dashed Frame)
  // We define a 1.0 size box that stays centered at 0,0,0
  // even when you move the inner shape.
  float boundary = sdBox(pos, vec3(0.5, 0.5, 0.5));

  // For now, we return only rayDis.
  // We'll combine the boundary in the next step so you can see it.
  return rayDis;
}
