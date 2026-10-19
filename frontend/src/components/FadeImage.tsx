import { useState, type ImgHTMLAttributes } from 'react'

// An image that fades in once it has loaded, instead of popping in line by line.
// Images the browser already has (complete on mount) show right away.
export default function FadeImage({ className = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      {...props}
      ref={(img) => {
        if (img?.complete && img.naturalWidth > 0 && !loaded) setLoaded(true)
      }}
      onLoad={() => setLoaded(true)}
      className={`fade-image${loaded ? ' is-loaded' : ''} ${className}`.trim()}
    />
  )
}
