import { Link } from 'react-router-dom'

const audiences = [
  {
    title: 'Students',
    text: 'Something warm for the walk across campus, a tee for intramurals, and a crewneck with your college crest.',
  },
  {
    title: 'Alumni',
    text: 'Back for a reunion or The Game? Pick up a piece that brings the old days right back.',
  },
  {
    title: 'Families',
    text: "Parents, siblings, and grandparents want to show they're proud too, and we have gear for that.",
  },
]

export default function About() {
  return (
    <section className="page narrow">
      <h1>About Campus Customs</h1>
      <p className="lead">
        We're a Yale apparel shop at 57 Broadway in New Haven. Our goal is simple: make it easy for
        anyone connected to Yale to show where they belong, whether that's a residential college, a
        varsity team, a graduate school, or just a love for the Bulldogs.
      </p>

      <h2>Who we make it for</h2>
      <div className="highlights">
        {audiences.map((a) => (
          <div key={a.title} className="highlight">
            <h3>{a.title}</h3>
            <p>{a.text}</p>
          </div>
        ))}
      </div>

      <h2>What we care about</h2>
      <ul className="about-list">
        <li>
          <strong>The real thing.</strong> Everything we sell is officially licensed Yale
          merchandise.
        </li>
        <li>
          <strong>Comfort first.</strong> Our clothes are made to be worn every day, not saved for
          special occasions.
        </li>
        <li>
          <strong>The details.</strong> College crests, team wordmarks, and school seals are what
          make a piece feel like yours.
        </li>
      </ul>

      <h2>Come visit</h2>
      <p>
        Stop by 57 Broadway, New Haven, CT, or <Link to="/products">shop online</Link>. Questions?
        Open the chat in the bottom corner and our assistant will help.
      </p>
    </section>
  )
}
