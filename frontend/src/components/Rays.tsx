/* The three rising stripes from the church flier (periwinkle, gold, navy). */

const SHAPES = {
  hero: [
    "460,596 1200,110 1200,214 460,600",
    "460,603 1200,234 1200,298 460,606",
    "460,609 1200,318 1200,452 460,614",
  ],
  page: [
    "560,620 1200,170 1200,268 560,620",
    "560,620 1200,290 1200,350 560,620",
    "560,620 1200,372 1200,500 560,620",
  ],
  band: [
    "0,620 1200,40 1200,150 0,620",
    "0,620 1200,175 1200,240 0,620",
    "0,620 1200,265 1200,400 0,620",
  ],
};

export default function Rays({ variant }: { variant: keyof typeof SHAPES }) {
  const [a, b, c] = SHAPES[variant];
  return (
    <svg className="rays" viewBox="0 0 1200 620" preserveAspectRatio="none" aria-hidden>
      <polygon className="r1" points={a} />
      <polygon className="r2" points={b} />
      <polygon className="r3" points={c} />
    </svg>
  );
}
