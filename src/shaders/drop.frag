#version 300 es
precision mediump float;
uniform sampler2D uDrop;                   // rg = Codrops drop-color, a = drop-alpha
in vec2 vUv;
in float vA;
out vec4 o;
void main() {
  vec4 t = texture(uDrop, vUv);
  o = vec4(t.rg, 0.0, t.a * vA);
}
