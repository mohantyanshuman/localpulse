const test = require('node:test');
const assert = require('node:assert');
const OA = require('../../services/eo/officialalerts');
const confirm = require('../../services/eo/confirm');

const GDACS_XML = `<rss><channel>
<item><title>Red alert Flood in Country X</title><gdacs:eventtype>FL</gdacs:eventtype><gdacs:alertlevel>Red</gdacs:alertlevel><geo:lat>18.50</geo:lat><geo:long>102.00</geo:long></item>
<item><title>Green quake far away</title><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:alertlevel>Green</gdacs:alertlevel><geo:lat>0.0</geo:lat><geo:long>0.0</geo:long></item>
</channel></rss>`;

test('GDACS parse + near maps event type to axis and keeps only orange/red within radius', () => {
  const ev = OA.parseEvents(GDACS_XML);
  assert.strictEqual(ev.length, 2);
  const near = OA.alertsNear(ev, 18.43, 102.02, 300);
  assert.strictEqual(near.length, 1);            // green/far one dropped
  assert.strictEqual(near[0].axis, 'flood');
  assert.strictEqual(near[0].severity, 'red');
  assert.strictEqual(near[0].authority, 'GDACS');
});

const SACHET_XML = `<rss><channel>
<item><title>Heavy rainfall warning for Solan district</title><author>India Meteorological Department (IMD)</author><category>Met</category></item>
<item><title>Flood warning Yamuna</title><author>Central Water Commission (CWC)</author><category>Flood</category></item>
<item><title>Heat wave over Rajasthan</title><author>(IMD)</author><category>Met</category></item>
</channel></rss>`;

test('NDMA Sachet India parse matches region terms and maps IMD/CWC channels to axes', () => {
  const got = OA.parseIndia(SACHET_XML, ['solan', 'himachal pradesh', 'india']);
  // Solan rainfall (IMD) matches; Yamuna/Rajasthan do not match "solan/himachal"
  assert.ok(got.some((a) => a.authority === 'IMD' && a.axis === 'flood'));
  assert.ok(!got.some((a) => /rajasthan/i.test(a.title)));
});

test('indiaAxis + channelOf classification', () => {
  assert.strictEqual(OA.indiaAxis('Heat wave'), 'heat');
  assert.strictEqual(OA.indiaAxis('Thunderstorm with squall'), 'storm');
  assert.strictEqual(OA.channelOf('India Meteorological Department (IMD)'), 'IMD');
  assert.strictEqual(OA.channelOf('Central Water Commission'), 'CWC');
});

test('an official alert is AUTHORITATIVE confirmation, overriding the >=2-sensor rule', () => {
  const c = confirm.confirm({ observedMag: 0.2, sensorCount: 1, official: { authority: 'IMD' } });
  assert.strictEqual(c.occurred, true);   // confirmed despite low magnitude + single sensor
  assert.strictEqual(c.confidence, 1);
  assert.strictEqual(c.official, true);
});
