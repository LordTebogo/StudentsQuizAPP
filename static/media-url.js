window.arounusThumb = (value, width = 640) => {
  try {
    const url = new URL(value, location.origin);
    if (url.hostname !== 'res.cloudinary.com' || !url.pathname.includes('/image/upload/')) return value;
    url.pathname = url.pathname.replace('/image/upload/', `/image/upload/c_limit,w_${Math.min(Math.max(width, 100), 1200)},h_800,q_auto,f_auto/`);
    return url.href;
  } catch { return value; }
};
