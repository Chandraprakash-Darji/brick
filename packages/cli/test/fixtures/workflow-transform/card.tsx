/** @jsxRuntime classic */
/** @jsx h */
export const h = (tag: string, props: unknown, ...children: unknown[]) => ({
  tag,
  props,
  children,
});
export const card = <b>hi</b>;

export async function render() {
  "use step";
  return card;
}
