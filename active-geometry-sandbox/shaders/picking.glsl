varying vec2 vUv;
uniform vec2  uResolution;
uniform mat4  uCamMatrix;
uniform vec3  uCamPos;
uniform float uFocalLen;

// Ray-marches the scene and outputs the 1-based shape index that owns the hit pixel.
// Index 0 (black) means the ray missed all geometry.
// Encoded as: red = hitIndex / 255.0  so the JS side reads pixel[0] directly.

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y;

    vec3 rayDirection = normalize((uCamMatrix * vec4(uv.x, uv.y, -uFocalLen, 0.0)).xyz);
    vec3 rayOrigin    = uCamPos;
    float totalDistance = 0.0;

    for (int i = 0; i < 80; i++) {
        vec3 currentPosition = rayOrigin + rayDirection * totalDistance;
        float dist = map(currentPosition);
        totalDistance += dist;
        if (dist < 0.001 || totalDistance > 10000.0) break;
    }

    // Same convergence guard as the main fragment shader
    vec3 finalPos = rayOrigin + rayDirection * totalDistance;
    if (totalDistance < 10000.0 && map(finalPos) > 0.05) totalDistance = 1e10;

    int hitIndex = 0;
    if (totalDistance < 10000.0) {
        hitIndex = mapIndex(rayOrigin + rayDirection * totalDistance);
    }

    gl_FragColor = vec4(float(hitIndex) / 255.0, 0.0, 0.0, 1.0);
}
