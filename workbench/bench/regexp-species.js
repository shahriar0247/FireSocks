// A/B microbenchmark for the RegExp species fuse (bug 1956245).
// Measures split/matchAll with the fuse intact (fast path), then pops the
// fuse (one-way) and re-measures the SpeciesConstructor slow path.
// Run: js --strict-benchmark-mode regexp-species.js

function bench(name, fn, iters) {
  for (var i = 0; i < 1000; i++) fn(i);
  var t0 = dateNow();
  for (var i = 0; i < iters; i++) fn(i);
  var dt = dateNow() - t0;
  print(name + ": " + dt.toFixed(1) + "ms for " + iters + " iters");
  return dt;
}

var s = "foo-bar-baz-qux-quux-corge-grault-garply-waldo-fred-plugh";
var re = /-/;
var reGlobal = /,/g;
var csv = Array(20).join("x,"); // ~19 commas

var fast_split = bench("split-default (fuse intact)", () => s.split(re), 500000);
var fast_ma = bench("matchAll-iter (fuse intact)", () => {
  var it = csv.matchAll(reGlobal); it.next();
}, 200000);

// Pop the species fuse permanently: write to RegExp.prototype.constructor.
var desc = Object.getOwnPropertyDescriptor(RegExp.prototype, "constructor");
RegExp.prototype.constructor = function FakeCtor() {};
Object.defineProperty(RegExp.prototype, "constructor", desc);

var slow_split = bench("split-default (fuse popped)", () => s.split(re), 500000);
var slow_ma = bench("matchAll-iter (fuse popped)", () => {
  var it = csv.matchAll(reGlobal); it.next();
}, 200000);

print("split delta: " + ((slow_split - fast_split) / fast_split * 100).toFixed(1) + "% slower without fuse");
print("matchAll delta: " + ((slow_ma - fast_ma) / fast_ma * 100).toFixed(1) + "% slower without fuse");
