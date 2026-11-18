// Pure tests for the link-preview parser (no network, no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata } from '../src/preview.js';

test('HTML entities in JSON-LD titles are decoded, and nothing else is injected', () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Чипси Lay&#39;s &amp; Co &lt;b&gt;","offers":{"price":"59.90","priceCurrency":"UAH"}}</script>`;
  const out = extractMetadata(html, 'https://shop.example/p/1');
  assert.equal(out.title, 'Чипси Lay\'s & Co <b>');
  assert.equal(out.price, 59.9);
});
