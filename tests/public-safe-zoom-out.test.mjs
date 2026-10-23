import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../public/project/index.html", import.meta.url),
  "utf8",
);

test("existing-auto mode preserves original fit; configured start focus uses bounded zoom", () => {
  assert.match(page, /function reset\(\)\{/);
  assert.match(page, /scale=focus\?configuredFocusScale\(focus\):fit/);
  assert.match(page, /pan=initialPanForPresentation\(\)/);
  assert.match(page, /Math\.min\(fit\*4\.5,required\*1\.01\)/);
  assert.match(page, /fit = mobile \? Math\.max\(fw,fh\) : containFit/);
});

test("mobile zoom-out floor is full-image contain fit instead of opening cover fit", () => {
  assert.match(page, /let fit = 1, minFit = 1, scale = 1/);
  assert.match(page, /const containFit = Math\.min\(fw,fh\)/);
  assert.match(
    page,
    /minFit = Number\.isFinite\(containFit\) && containFit > 0[\s\S]*?Math\.min\(containFit,fit\)[\s\S]*?: fit/,
  );
  assert.match(
    page,
    /function zoomAt\(newScale,sx,sy\)\{presentationUserAdjusted=true;newScale=clamp\(newScale,minFit,fit\*4\.5\)/,
  );
});

test("pinch and viewport resize preserve the same safe zoom-out floor", () => {
  assert.match(
    page,
    /const ns=clamp\(gesture\.scale\*distance\(a,b\)\/gesture\.dist,minFit,fit\*4\.5\)/,
  );
  assert.match(
    page,
    /calcFit\(\);scale=clamp\(fit\*z,minFit,fit\*4\.5\);render\(\)/,
  );
});

test("zoom-out patch keeps image and clickable polygons on one transformed world", () => {
  assert.match(
    page,
    /world\.style\.transform = .*scale\(\$\{scale\}\) rotate\(\$\{publicRotation\*90\}deg\)/,
  );
  assert.match(page, /const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
});
