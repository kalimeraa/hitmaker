# Bundled panel assets

The panel uses these local assets so login and task controls work without CDN
access. Files are unmodified copies from the pinned npm distribution tarballs:

- `bootstrap@5.3.3`: `dist/css/bootstrap.min.css`,
  `dist/js/bootstrap.bundle.min.js`, and `LICENSE`.
- `jquery@3.7.1`: `dist/jquery.min.js` and `LICENSE.txt`.

Source packages: <https://www.npmjs.com/package/bootstrap/v/5.3.3> and
<https://www.npmjs.com/package/jquery/v/3.7.1>.

SHA-256:

```text
3c8f27e6009ccfd710a905e6dcf12d0ee3c6f2ac7da05b0572d3e0d12e736fc8  bootstrap/bootstrap.min.css
0833b2e9c3a26c258476c46266e6877fc75218625162e0460be9a3a098a61c6c  bootstrap/bootstrap.bundle.min.js
fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a  jquery/jquery.min.js
```

The Windows lifecycle smoke test blocks external browser requests and verifies
local form login, jQuery, Bootstrap and the panel application script.
