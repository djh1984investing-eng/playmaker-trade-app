export default function handler(_req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(`User-agent: *
Allow: /

Sitemap: https://www.futuresplaymaker.com/sitemap.xml
`);
}
