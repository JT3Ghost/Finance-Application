# Shareable Link Setup

The local preview URL, such as `http://127.0.0.1:4173`, only works on your own computer. To share the app with other people, publish this folder to a static host and send the public `https://...` URL.

## Fastest option: Netlify Drop

1. Go to `https://app.netlify.com/drop`.
2. Drag the whole `New project` folder onto the page.
3. Netlify gives you a public URL. That is the link to share.

## Vercel

1. Create a new Vercel project.
2. Import or upload this folder.
3. Use the default static settings. The included `vercel.json` adds the browser headers.

## GitHub Pages

1. Put these files in a GitHub repository.
2. In repository settings, enable Pages for the branch that contains `index.html`.
3. Share the GitHub Pages URL.

## Camera note

Receipt camera scanning requires a secure browser context. Public `https://` hosting works. Plain `http://` sharing usually blocks the camera.
