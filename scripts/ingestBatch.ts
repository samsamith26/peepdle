/**
 * Batch ingestion for Actordle + Athletedle.
 *
 * Uses hardcoded curated candidate lists (~700 actors, ~700 athletes) for
 * consistent, diverse coverage across eras and leagues. Processes 100
 * candidates at a time so you can spot-check results between batches.
 *
 * Usage:
 *   npx tsx scripts/ingestBatch.ts --pool actors   --batch 0
 *   npx tsx scripts/ingestBatch.ts --pool athletes --batch 0
 *
 * Skips (with logged reason) when any required field is missing:
 *   actors   → name, birthYear, nationality, ≥1 genre, ≥1 collaborator, director, image
 *   athletes → name, birthYear, sport, team, position, heightCm, image
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const getArg = (flag: string) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
};
const POOL = getArg("--pool") as "actors" | "athletes" | undefined;
const BATCH = parseInt(getArg("--batch") ?? "0", 10);
const BATCH_SIZE = parseInt(getArg("--batch-size") ?? "100", 10);

if (!POOL || !["actors", "athletes"].includes(POOL)) {
  console.error("Usage: npx tsx scripts/ingestBatch.ts --pool actors|athletes --batch N");
  process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SPARQL_EP = "https://query.wikidata.org/sparql";
const COMMONS_EP = "https://commons.wikimedia.org/w/api.php";
const UA = "celebridle-ingest/1.0 (samuel.smith2204@gmail.com)";
const THUMB_W = 300;
const CURRENT_YEAR = new Date().getFullYear();
const SPARQL_DELAY = 1400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Candidate lists ───────────────────────────────────────────────────────────

export const ACTOR_CANDIDATES: string[] = [
  // Classic Hollywood 1920s-1950s
  "Humphrey Bogart", "James Cagney", "Edward G. Robinson", "Henry Fonda",
  "Gary Cooper", "Clark Gable", "Cary Grant", "James Stewart", "Bette Davis",
  "Joan Crawford", "Barbara Stanwyck", "Katharine Hepburn", "Ingrid Bergman",
  "Grace Kelly", "Audrey Hepburn", "Vivien Leigh", "Marlon Brando",
  "Montgomery Clift", "Gregory Peck", "Charlton Heston", "Kirk Douglas",
  "Burt Lancaster", "William Holden", "Spencer Tracy", "Gene Kelly",
  "Fred Astaire", "Ginger Rogers", "Judy Garland", "James Dean",
  "Rock Hudson", "Doris Day", "Deborah Kerr", "Ava Gardner",
  "Rita Hayworth", "Lana Turner", "Gloria Swanson", "Claudette Colbert",
  "Irene Dunne", "Myrna Loy", "Carole Lombard", "Hedy Lamarr",
  "Tyrone Power", "Errol Flynn", "Robert Mitchum", "Dana Andrews",
  "Alan Ladd", "Donna Reed", "Patricia Neal", "Olivia de Havilland",
  "Joan Fontaine", "Rosalind Russell", "Greer Garson", "Betty Grable",
  "Jane Wyman", "Agnes Moorehead", "Jean Arthur", "Loretta Young",
  "Norma Shearer", "Jean Harlow", "Mae West", "Tallulah Bankhead",
  // New Hollywood & British New Wave 1960s-1970s
  "Paul Newman", "Robert Redford", "Jack Nicholson", "Warren Beatty",
  "Robert Duvall", "Gene Hackman", "Dustin Hoffman", "Jon Voight",
  "Steve McQueen", "Clint Eastwood", "Peter Fonda", "Dennis Hopper",
  "Donald Sutherland", "Elliott Gould", "Harvey Keitel",
  "Richard Dreyfuss", "Roy Scheider", "Al Pacino", "Robert De Niro",
  "Diane Keaton", "Faye Dunaway", "Jane Fonda", "Glenda Jackson",
  "Ellen Burstyn", "Sissy Spacek", "Vanessa Redgrave", "Shirley MacLaine",
  "Anne Bancroft", "Joanne Woodward", "Julie Andrews", "Natalie Wood",
  "Kim Novak", "Shelley Winters", "Janet Leigh", "Tony Curtis",
  "Yul Brynner", "Anthony Quinn", "Sidney Poitier", "Harry Belafonte",
  "Ossie Davis", "Ruby Dee", "Louis Gossett Jr.", "James Earl Jones",
  "Billy Dee Williams", "Richard Roundtree", "Alan Arkin",
  "Malcolm McDowell", "Liv Ullmann", "Peter O'Toole", "Richard Burton",
  "Michael Caine", "Albert Finney", "Tom Courtenay", "Terence Stamp",
  "Alan Bates", "Peter Sellers", "Dudley Moore", "Gene Wilder",
  "Richard Pryor", "Burt Reynolds", "Ryan O'Neal", "Candice Bergen",
  "Cybill Shepherd", "Katharine Ross", "Liza Minnelli", "Barbra Streisand",
  "Pam Grier", "Lily Tomlin", "Bette Midler", "Diahann Carroll",
  "Lee Marvin", "Ernest Borgnine", "Karl Malden", "Walter Matthau",
  "Jack Lemmon", "George Segal", "Richard Benjamin", "Ryan O'Neal",
  "Sean Connery", "Roger Moore", "Richard Harris", "Rex Harrison",
  "Laurence Olivier", "Dirk Bogarde", "Trevor Howard",
  // 1980s
  "Tom Hanks", "Tom Cruise", "Harrison Ford", "Mel Gibson",
  "Sylvester Stallone", "Arnold Schwarzenegger", "Bruce Willis",
  "Kevin Costner", "Richard Gere", "Bill Murray", "Dan Aykroyd",
  "Eddie Murphy", "Steve Martin", "Whoopi Goldberg", "Sally Field",
  "Meryl Streep", "Glenn Close", "Jessica Lange", "Cher", "Goldie Hawn",
  "Sigourney Weaver", "Kathleen Turner", "Debra Winger",
  "Michelle Pfeiffer", "Kim Basinger", "Molly Ringwald", "Rob Lowe",
  "Matthew Broderick", "Charlie Sheen", "Michael J. Fox", "Sean Penn",
  "Nicolas Cage", "Jeff Bridges", "Kevin Kline", "John Malkovich",
  "Gary Oldman", "Daniel Day-Lewis", "Michael Keaton", "Patrick Swayze",
  "Kurt Russell", "John Cusack", "James Spader", "Robin Williams",
  "Emilio Estevez", "Judd Nelson", "Ally Sheedy", "Anthony Michael Hall",
  "Demi Moore", "Meg Ryan", "Jamie Lee Curtis", "Carrie Fisher",
  "Geena Davis", "Jennifer Jason Leigh", "Michael Douglas",
  "Dennis Quaid", "Alec Baldwin", "Timothy Hutton", "Matthew Modine",
  "Tom Berenger", "Willem Dafoe", "Mickey Rourke", "James Woods",
  "Chevy Chase", "Bill Paxton", "Jeff Goldblum", "Jeremy Irons",
  "Ben Kingsley", "Sam Neill", "Kiefer Sutherland", "Brendan Fraser",
  // 1990s
  "Brad Pitt", "Johnny Depp", "Leonardo DiCaprio", "Matt Damon",
  "Ben Affleck", "Will Smith", "Denzel Washington", "Samuel L. Jackson",
  "Morgan Freeman", "Jim Carrey", "Adam Sandler", "Mike Myers",
  "Owen Wilson", "Vince Vaughn", "Chris Rock", "Martin Lawrence",
  "Wesley Snipes", "Cuba Gooding Jr.", "Laurence Fishburne",
  "Forest Whitaker", "Don Cheadle", "Halle Berry", "Sandra Bullock",
  "Julia Roberts", "Cameron Diaz", "Jennifer Aniston", "Gwyneth Paltrow",
  "Uma Thurman", "Jodie Foster", "Annette Bening", "Susan Sarandon",
  "Frances McDormand", "Laura Dern", "Julianne Moore", "Cate Blanchett",
  "Judi Dench", "Helen Mirren", "Emma Thompson", "Kate Winslet",
  "Rachel Weisz", "Renée Zellweger", "Charlize Theron",
  "Reese Witherspoon", "Nicole Kidman", "Naomi Watts", "Hilary Swank",
  "Winona Ryder", "Drew Barrymore", "George Clooney", "Russell Crowe",
  "Hugh Jackman", "Jude Law", "Ewan McGregor", "Ralph Fiennes",
  "Geoffrey Rush", "Paul Bettany", "Guy Pearce", "Helena Bonham Carter",
  "Tilda Swinton", "Kristin Scott Thomas", "Colin Firth", "Hugh Grant",
  "Pierce Brosnan", "Liam Neeson", "Clive Owen", "Colin Farrell",
  "Adrien Brody", "Joaquin Phoenix", "Matthew McConaughey",
  "Jake Gyllenhaal", "Heath Ledger", "Tobey Maguire", "Andrew Garfield",
  "Jennifer Love Hewitt", "Neve Campbell", "Sarah Michelle Gellar",
  "Maggie Smith", "Ian McKellen", "Patrick Stewart", "Anthony Hopkins",
  "Kenneth Branagh", "Ian Holm", "Derek Jacobi", "Jim Broadbent",
  "Pete Postlethwaite", "Timothy Spall", "Tom Wilkinson",
  "Philip Seymour Hoffman", "Paul Giamatti", "William H. Macy",
  "Steve Buscemi", "John Turturro", "Christopher Walken", "Nick Nolte",
  "William Hurt", "Ed Harris", "Kathy Bates", "Diane Wiest",
  "Mary Steenburgen", "Teri Garr", "Gena Rowlands", "Geraldine Page",
  // 2000s
  "Robert Downey Jr.", "Chris Evans", "Chris Hemsworth", "Chris Pratt",
  "Mark Ruffalo", "Scarlett Johansson", "Jennifer Lawrence",
  "Natalie Portman", "Keira Knightley", "Orlando Bloom",
  "Joseph Gordon-Levitt", "Shia LaBeouf", "Megan Fox", "Jessica Alba",
  "Eva Mendes", "Penélope Cruz", "Salma Hayek", "Jennifer Lopez",
  "Jennifer Garner", "Vin Diesel", "Dwayne Johnson", "Jason Statham",
  "Gerard Butler", "Bradley Cooper", "Michael Fassbender", "James McAvoy",
  "Tom Hardy", "Benedict Cumberbatch", "Eddie Redmayne", "Idris Elba",
  "Chiwetel Ejiofor", "Oscar Isaac", "Mahershala Ali", "Michael B. Jordan",
  "Chadwick Boseman", "Anthony Mackie", "Angela Bassett",
  "Taraji P. Henson", "Kerry Washington", "Viola Davis", "Octavia Spencer",
  "Lupita Nyong'o", "Zoe Saldana", "Amy Adams", "Anne Hathaway",
  "Emily Blunt", "Jessica Chastain", "Melissa McCarthy", "Kristen Wiig",
  "Emma Stone", "Carey Mulligan", "Rooney Mara", "Taron Egerton",
  "Jeremy Renner", "Aaron Paul", "Bryan Cranston", "Jon Hamm",
  "Michael Shannon", "Karl Urban", "Chris Pine", "Zachary Quinto",
  "Simon Pegg", "Paul Rudd", "Jason Bateman", "Will Ferrell",
  "Sacha Baron Cohen", "Jack Black", "Ben Stiller", "Steve Carell",
  "Seth Rogen", "James Franco", "Jonah Hill", "Zac Efron",
  "Channing Tatum", "Ryan Reynolds",
  // 2010s-2020s
  "Timothée Chalamet", "Florence Pugh", "Anya Taylor-Joy", "Zendaya",
  "Pedro Pascal", "Saoirse Ronan", "Paul Mescal", "Andrew Scott",
  "Barry Keoghan", "Mia Goth", "Hailee Steinfeld", "Jenna Ortega",
  "Jacob Elordi", "Austin Butler", "Ana de Armas", "Alicia Vikander",
  "Rebecca Ferguson", "Tom Hiddleston", "Ryan Gosling", "Daniel Radcliffe",
  "Emma Watson", "Rupert Grint", "Cillian Murphy", "Rami Malek",
  "Ansel Elgort", "Miles Teller", "Shailene Woodley", "Brie Larson",
  "Gal Gadot", "Margot Robbie", "Elizabeth Debicki", "Daisy Ridley",
  "John Boyega", "Adam Driver", "Donald Glover", "Lakeith Stanfield",
  "Brian Tyree Henry", "Regina King", "Alfre Woodard", "Cicely Tyson",
  "Queen Latifah", "Jada Pinkett Smith", "Regina Hall",
  // International
  "Antonio Banderas", "Javier Bardem", "Gael García Bernal", "Diego Luna",
  "Jackie Chan", "Jet Li", "Zhang Ziyi", "Chow Yun-fat", "Tony Leung",
  "Ken Watanabe", "Toshiro Mifune", "Gong Li", "Michelle Yeoh",
  "Christoph Waltz", "Diane Kruger", "Monica Bellucci", "Sophia Loren",
  "Marcello Mastroianni", "Roberto Benigni", "Jean-Paul Belmondo",
  "Alain Delon", "Catherine Deneuve", "Isabelle Huppert",
  "Marion Cotillard", "Omar Sharif", "Amitabh Bachchan",
  "Priyanka Chopra", "Aishwarya Rai", "Albert Sordi", "Gina Lollobrigida",
  "Claudia Cardinale", "Giancarlo Giannini", "Ornella Muti",
  "Jean-Louis Trintignant", "Annie Girardot", "Simone Signoret",
  "Yves Montand", "Juliette Binoche", "Vincent Cassel", "Audrey Tautou",
  "Mathieu Amalric", "Louis de Funès", "Gérard Depardieu",
  // Character actors & supporting leads
  "Alan Rickman", "Mark Rylance", "Stanley Tucci", "John Lithgow",
  "Danny DeVito", "Brian Cox", "Richard E. Grant", "Bob Hoskins",
  "Toby Jones", "Michael Sheen", "Jason Isaacs", "Mark Strong",
  "Tom Wilkinson", "Pete Postlethwaite", "David Thewlis", "Rhys Ifans",
  "Jeff Daniels", "Ed Begley Jr.", "Ron Perlman", "Vincent D'Onofrio",
  "Kiefer Sutherland", "James Marsden", "Sam Neill", "Bryan Brown",
  "Judy Davis", "Maggie Gyllenhaal", "Laura Linney", "Patricia Clarkson",
  "Parker Posey", "Mary-Louise Parker", "Marcia Gay Harden",
  "Chloë Sevigny", "Ellen Page", "Evan Rachel Wood", "Carey Mulligan",
  "Greta Gerwig", "Miranda July", "Catherine Keener",
  "Gary Sinise", "John C. Reilly", "Tim Robbins", "Kevin Bacon",
  "Gary Busey", "Nick Nolte", "Harry Dean Stanton", "Warren Oates",
  "Strother Martin", "Richard Farnsworth",
];

export const ATHLETE_CANDIDATES: Array<{ name: string; sport: string }> = [
  // ── NBA ───────────────────────────────────────────────────────────────────
  { name: "LeBron James", sport: "NBA" },
  { name: "Michael Jordan", sport: "NBA" },
  { name: "Kobe Bryant", sport: "NBA" },
  { name: "Stephen Curry", sport: "NBA" },
  { name: "Magic Johnson", sport: "NBA" },
  { name: "Larry Bird", sport: "NBA" },
  { name: "Kareem Abdul-Jabbar", sport: "NBA" },
  { name: "Shaquille O'Neal", sport: "NBA" },
  { name: "Tim Duncan", sport: "NBA" },
  { name: "Kevin Durant", sport: "NBA" },
  { name: "Giannis Antetokounmpo", sport: "NBA" },
  { name: "Nikola Jokic", sport: "NBA" },
  { name: "Joel Embiid", sport: "NBA" },
  { name: "Luka Dončić", sport: "NBA" },
  { name: "Jayson Tatum", sport: "NBA" },
  { name: "Ja Morant", sport: "NBA" },
  { name: "Anthony Davis", sport: "NBA" },
  { name: "Russell Westbrook", sport: "NBA" },
  { name: "James Harden", sport: "NBA" },
  { name: "Kevin Garnett", sport: "NBA" },
  { name: "Paul Pierce", sport: "NBA" },
  { name: "Ray Allen", sport: "NBA" },
  { name: "Allen Iverson", sport: "NBA" },
  { name: "Dirk Nowitzki", sport: "NBA" },
  { name: "Steve Nash", sport: "NBA" },
  { name: "Dwyane Wade", sport: "NBA" },
  { name: "Chris Paul", sport: "NBA" },
  { name: "Dwight Howard", sport: "NBA" },
  { name: "Paul George", sport: "NBA" },
  { name: "Kawhi Leonard", sport: "NBA" },
  { name: "Damian Lillard", sport: "NBA" },
  { name: "Kyrie Irving", sport: "NBA" },
  { name: "Carmelo Anthony", sport: "NBA" },
  { name: "Vince Carter", sport: "NBA" },
  { name: "Tracy McGrady", sport: "NBA" },
  { name: "Yao Ming", sport: "NBA" },
  { name: "Tony Parker", sport: "NBA" },
  { name: "Manu Ginóbili", sport: "NBA" },
  { name: "David Robinson", sport: "NBA" },
  { name: "Patrick Ewing", sport: "NBA" },
  { name: "Charles Barkley", sport: "NBA" },
  { name: "Karl Malone", sport: "NBA" },
  { name: "John Stockton", sport: "NBA" },
  { name: "Reggie Miller", sport: "NBA" },
  { name: "Scottie Pippen", sport: "NBA" },
  { name: "Dennis Rodman", sport: "NBA" },
  { name: "Gary Payton", sport: "NBA" },
  { name: "Alonzo Mourning", sport: "NBA" },
  { name: "Grant Hill", sport: "NBA" },
  { name: "Jason Kidd", sport: "NBA" },
  { name: "Penny Hardaway", sport: "NBA" },
  { name: "Hakeem Olajuwon", sport: "NBA" },
  { name: "Clyde Drexler", sport: "NBA" },
  { name: "Dominique Wilkins", sport: "NBA" },
  { name: "Julius Erving", sport: "NBA" },
  { name: "Moses Malone", sport: "NBA" },
  { name: "Bill Russell", sport: "NBA" },
  { name: "Wilt Chamberlain", sport: "NBA" },
  { name: "Oscar Robertson", sport: "NBA" },
  { name: "Jerry West", sport: "NBA" },
  { name: "Elgin Baylor", sport: "NBA" },
  { name: "Bob Cousy", sport: "NBA" },
  { name: "Pete Maravich", sport: "NBA" },
  { name: "Isiah Thomas", sport: "NBA" },
  { name: "Joe Dumars", sport: "NBA" },
  { name: "Detlef Schrempf", sport: "NBA" },
  { name: "Mark Price", sport: "NBA" },
  { name: "Mitch Richmond", sport: "NBA" },
  { name: "Glen Rice", sport: "NBA" },
  { name: "Latrell Sprewell", sport: "NBA" },
  { name: "Nick Van Exel", sport: "NBA" },
  { name: "Shareef Abdur-Rahim", sport: "NBA" },
  { name: "Antonio McDyess", sport: "NBA" },
  { name: "Stephon Marbury", sport: "NBA" },
  { name: "Baron Davis", sport: "NBA" },
  { name: "Gilbert Arenas", sport: "NBA" },
  { name: "Amar'e Stoudemire", sport: "NBA" },
  { name: "Deron Williams", sport: "NBA" },
  { name: "Brandon Roy", sport: "NBA" },
  { name: "LaMarcus Aldridge", sport: "NBA" },
  { name: "Marc Gasol", sport: "NBA" },
  { name: "Pau Gasol", sport: "NBA" },
  { name: "Brook Lopez", sport: "NBA" },
  { name: "Al Horford", sport: "NBA" },
  { name: "Blake Griffin", sport: "NBA" },
  { name: "DeMar DeRozan", sport: "NBA" },
  { name: "Kyle Lowry", sport: "NBA" },
  { name: "Kemba Walker", sport: "NBA" },
  { name: "Jimmy Butler", sport: "NBA" },
  { name: "Bam Adebayo", sport: "NBA" },
  { name: "Zion Williamson", sport: "NBA" },
  { name: "De'Aaron Fox", sport: "NBA" },
  { name: "Donovan Mitchell", sport: "NBA" },
  { name: "Devin Booker", sport: "NBA" },
  { name: "Trae Young", sport: "NBA" },
  { name: "Shai Gilgeous-Alexander", sport: "NBA" },
  { name: "Cade Cunningham", sport: "NBA" },
  { name: "Evan Mobley", sport: "NBA" },
  { name: "Paolo Banchero", sport: "NBA" },
  { name: "Victor Wembanyama", sport: "NBA" },
  // ── NFL ───────────────────────────────────────────────────────────────────
  { name: "Tom Brady", sport: "NFL" },
  { name: "Jerry Rice", sport: "NFL" },
  { name: "Jim Brown", sport: "NFL" },
  { name: "Walter Payton", sport: "NFL" },
  { name: "Lawrence Taylor", sport: "NFL" },
  { name: "Joe Montana", sport: "NFL" },
  { name: "Peyton Manning", sport: "NFL" },
  { name: "John Elway", sport: "NFL" },
  { name: "Brett Favre", sport: "NFL" },
  { name: "Dan Marino", sport: "NFL" },
  { name: "Barry Sanders", sport: "NFL" },
  { name: "Emmitt Smith", sport: "NFL" },
  { name: "Randy Moss", sport: "NFL" },
  { name: "Terrell Owens", sport: "NFL" },
  { name: "Tony Gonzalez", sport: "NFL" },
  { name: "Ray Lewis", sport: "NFL" },
  { name: "Reggie White", sport: "NFL" },
  { name: "Deion Sanders", sport: "NFL" },
  { name: "Ronnie Lott", sport: "NFL" },
  { name: "Dick Butkus", sport: "NFL" },
  { name: "Mike Singletary", sport: "NFL" },
  { name: "Mean Joe Greene", sport: "NFL" },
  { name: "Bruce Smith", sport: "NFL" },
  { name: "Derrick Thomas", sport: "NFL" },
  { name: "Ed Reed", sport: "NFL" },
  { name: "Troy Polamalu", sport: "NFL" },
  { name: "Charles Woodson", sport: "NFL" },
  { name: "Patrick Mahomes", sport: "NFL" },
  { name: "Aaron Rodgers", sport: "NFL" },
  { name: "Russell Wilson", sport: "NFL" },
  { name: "Drew Brees", sport: "NFL" },
  { name: "Eli Manning", sport: "NFL" },
  { name: "Ben Roethlisberger", sport: "NFL" },
  { name: "Steve Young", sport: "NFL" },
  { name: "Troy Aikman", sport: "NFL" },
  { name: "Jim Kelly", sport: "NFL" },
  { name: "Kurt Warner", sport: "NFL" },
  { name: "Fran Tarkenton", sport: "NFL" },
  { name: "Roger Staubach", sport: "NFL" },
  { name: "Terry Bradshaw", sport: "NFL" },
  { name: "Johnny Unitas", sport: "NFL" },
  { name: "Bart Starr", sport: "NFL" },
  { name: "Sammy Baugh", sport: "NFL" },
  { name: "LaDainian Tomlinson", sport: "NFL" },
  { name: "Adrian Peterson", sport: "NFL" },
  { name: "Marshall Faulk", sport: "NFL" },
  { name: "Eric Dickerson", sport: "NFL" },
  { name: "Earl Campbell", sport: "NFL" },
  { name: "Tony Dorsett", sport: "NFL" },
  { name: "Marcus Allen", sport: "NFL" },
  { name: "Thurman Thomas", sport: "NFL" },
  { name: "Frank Gore", sport: "NFL" },
  { name: "Marshawn Lynch", sport: "NFL" },
  { name: "Derrick Henry", sport: "NFL" },
  { name: "Christian McCaffrey", sport: "NFL" },
  { name: "Saquon Barkley", sport: "NFL" },
  { name: "Alvin Kamara", sport: "NFL" },
  { name: "Ezekiel Elliott", sport: "NFL" },
  { name: "Todd Gurley", sport: "NFL" },
  { name: "Kareem Hunt", sport: "NFL" },
  { name: "Nick Chubb", sport: "NFL" },
  { name: "Davante Adams", sport: "NFL" },
  { name: "Tyreek Hill", sport: "NFL" },
  { name: "Stefon Diggs", sport: "NFL" },
  { name: "DeAndre Hopkins", sport: "NFL" },
  { name: "A.J. Green", sport: "NFL" },
  { name: "Calvin Johnson", sport: "NFL" },
  { name: "Steve Smith", sport: "NFL" },
  { name: "Isaac Bruce", sport: "NFL" },
  { name: "Torry Holt", sport: "NFL" },
  { name: "Antonio Brown", sport: "NFL" },
  { name: "Julio Jones", sport: "NFL" },
  { name: "Rob Gronkowski", sport: "NFL" },
  { name: "Shannon Sharpe", sport: "NFL" },
  { name: "Ozzie Newsome", sport: "NFL" },
  { name: "Kellen Winslow", sport: "NFL" },
  { name: "Mike Ditka", sport: "NFL" },
  { name: "Walter Jones", sport: "NFL" },
  { name: "Anthony Munoz", sport: "NFL" },
  { name: "Orlando Pace", sport: "NFL" },
  { name: "Jonathan Ogden", sport: "NFL" },
  { name: "Joe Thomas", sport: "NFL" },
  { name: "Gary Clark", sport: "NFL" },
  { name: "Chris Carter", sport: "NFL" },
  { name: "Tim Brown", sport: "NFL" },
  { name: "Shannon Sharpe", sport: "NFL" },
  { name: "Lamar Jackson", sport: "NFL" },
  { name: "Josh Allen", sport: "NFL" },
  { name: "Joe Burrow", sport: "NFL" },
  { name: "Justin Herbert", sport: "NFL" },
  { name: "Jalen Hurts", sport: "NFL" },
  { name: "Justin Jefferson", sport: "NFL" },
  { name: "Cooper Kupp", sport: "NFL" },
  { name: "Travis Kelce", sport: "NFL" },
  { name: "George Kittle", sport: "NFL" },
  { name: "Nick Bosa", sport: "NFL" },
  { name: "Myles Garrett", sport: "NFL" },
  { name: "Micah Parsons", sport: "NFL" },
  { name: "T.J. Watt", sport: "NFL" },
  { name: "Maxx Crosby", sport: "NFL" },
  // ── MLB ───────────────────────────────────────────────────────────────────
  { name: "Mike Trout", sport: "MLB" },
  { name: "Derek Jeter", sport: "MLB" },
  { name: "Babe Ruth", sport: "MLB" },
  { name: "Willie Mays", sport: "MLB" },
  { name: "Hank Aaron", sport: "MLB" },
  { name: "Ted Williams", sport: "MLB" },
  { name: "Mickey Mantle", sport: "MLB" },
  { name: "Cal Ripken Jr.", sport: "MLB" },
  { name: "Ken Griffey Jr.", sport: "MLB" },
  { name: "Barry Bonds", sport: "MLB" },
  { name: "Roger Clemens", sport: "MLB" },
  { name: "Randy Johnson", sport: "MLB" },
  { name: "Pedro Martínez", sport: "MLB" },
  { name: "Greg Maddux", sport: "MLB" },
  { name: "Tom Seaver", sport: "MLB" },
  { name: "Nolan Ryan", sport: "MLB" },
  { name: "Sandy Koufax", sport: "MLB" },
  { name: "Bob Gibson", sport: "MLB" },
  { name: "Johnny Bench", sport: "MLB" },
  { name: "Mike Piazza", sport: "MLB" },
  { name: "Ivan Rodriguez", sport: "MLB" },
  { name: "Carlton Fisk", sport: "MLB" },
  { name: "Yogi Berra", sport: "MLB" },
  { name: "Jackie Robinson", sport: "MLB" },
  { name: "Roberto Clemente", sport: "MLB" },
  { name: "Lou Gehrig", sport: "MLB" },
  { name: "Joe DiMaggio", sport: "MLB" },
  { name: "Stan Musial", sport: "MLB" },
  { name: "George Brett", sport: "MLB" },
  { name: "Wade Boggs", sport: "MLB" },
  { name: "Rickey Henderson", sport: "MLB" },
  { name: "Tony Gwynn", sport: "MLB" },
  { name: "Rod Carew", sport: "MLB" },
  { name: "Paul Molitor", sport: "MLB" },
  { name: "Robin Yount", sport: "MLB" },
  { name: "Dave Winfield", sport: "MLB" },
  { name: "Reggie Jackson", sport: "MLB" },
  { name: "Frank Robinson", sport: "MLB" },
  { name: "Harmon Killebrew", sport: "MLB" },
  { name: "Ernie Banks", sport: "MLB" },
  { name: "Brooks Robinson", sport: "MLB" },
  { name: "Ozzie Smith", sport: "MLB" },
  { name: "Gary Carter", sport: "MLB" },
  { name: "Ryne Sandberg", sport: "MLB" },
  { name: "Tony Pérez", sport: "MLB" },
  { name: "Jim Palmer", sport: "MLB" },
  { name: "Steve Carlton", sport: "MLB" },
  { name: "Catfish Hunter", sport: "MLB" },
  { name: "Don Drysdale", sport: "MLB" },
  { name: "Warren Spahn", sport: "MLB" },
  { name: "Whitey Ford", sport: "MLB" },
  { name: "Jim Kaat", sport: "MLB" },
  { name: "Bert Blyleven", sport: "MLB" },
  { name: "Fergie Jenkins", sport: "MLB" },
  { name: "Gaylord Perry", sport: "MLB" },
  { name: "Phil Niekro", sport: "MLB" },
  { name: "Jim Hunter", sport: "MLB" },
  { name: "Frank Thomas", sport: "MLB" },
  { name: "Ken Griffey Jr.", sport: "MLB" },
  { name: "Manny Ramirez", sport: "MLB" },
  { name: "Alex Rodriguez", sport: "MLB" },
  { name: "Albert Pujols", sport: "MLB" },
  { name: "David Ortiz", sport: "MLB" },
  { name: "Jim Thome", sport: "MLB" },
  { name: "Chipper Jones", sport: "MLB" },
  { name: "Vladimir Guerrero", sport: "MLB" },
  { name: "Gary Sheffield", sport: "MLB" },
  { name: "Andruw Jones", sport: "MLB" },
  { name: "Scott Rolen", sport: "MLB" },
  { name: "Todd Helton", sport: "MLB" },
  { name: "Curt Schilling", sport: "MLB" },
  { name: "Mike Mussina", sport: "MLB" },
  { name: "Johan Santana", sport: "MLB" },
  { name: "Roy Halladay", sport: "MLB" },
  { name: "Mariano Rivera", sport: "MLB" },
  { name: "Trevor Hoffman", sport: "MLB" },
  { name: "Lee Smith", sport: "MLB" },
  { name: "Ichiro Suzuki", sport: "MLB" },
  { name: "Hideki Matsui", sport: "MLB" },
  { name: "Carlos Beltrán", sport: "MLB" },
  { name: "Jimmy Rollins", sport: "MLB" },
  { name: "Chase Utley", sport: "MLB" },
  { name: "Ryan Howard", sport: "MLB" },
  { name: "Carlos Lee", sport: "MLB" },
  { name: "Justin Morneau", sport: "MLB" },
  { name: "Dustin Pedroia", sport: "MLB" },
  { name: "Evan Longoria", sport: "MLB" },
  { name: "Joey Votto", sport: "MLB" },
  { name: "Andrew McCutchen", sport: "MLB" },
  { name: "Buster Posey", sport: "MLB" },
  { name: "Yadier Molina", sport: "MLB" },
  { name: "Joe Mauer", sport: "MLB" },
  { name: "Prince Fielder", sport: "MLB" },
  { name: "Miguel Cabrera", sport: "MLB" },
  { name: "Justin Verlander", sport: "MLB" },
  { name: "Clayton Kershaw", sport: "MLB" },
  { name: "Max Scherzer", sport: "MLB" },
  { name: "Zack Greinke", sport: "MLB" },
  { name: "Felix Hernandez", sport: "MLB" },
  { name: "Corey Kluber", sport: "MLB" },
  { name: "Jacob deGrom", sport: "MLB" },
  { name: "Gerrit Cole", sport: "MLB" },
  { name: "Shohei Ohtani", sport: "MLB" },
  { name: "Freddie Freeman", sport: "MLB" },
  { name: "Mookie Betts", sport: "MLB" },
  { name: "Jose Altuve", sport: "MLB" },
  { name: "Bryce Harper", sport: "MLB" },
  { name: "Kris Bryant", sport: "MLB" },
  { name: "Francisco Lindor", sport: "MLB" },
  { name: "Juan Soto", sport: "MLB" },
  { name: "Fernando Tatis Jr.", sport: "MLB" },
  { name: "Vladimir Guerrero Jr.", sport: "MLB" },
  { name: "Bo Bichette", sport: "MLB" },
  { name: "Corbin Carroll", sport: "MLB" },
  // ── NHL ───────────────────────────────────────────────────────────────────
  { name: "Wayne Gretzky", sport: "NHL" },
  { name: "Mario Lemieux", sport: "NHL" },
  { name: "Gordie Howe", sport: "NHL" },
  { name: "Bobby Orr", sport: "NHL" },
  { name: "Maurice Richard", sport: "NHL" },
  { name: "Jean Béliveau", sport: "NHL" },
  { name: "Guy Lafleur", sport: "NHL" },
  { name: "Mark Messier", sport: "NHL" },
  { name: "Steve Yzerman", sport: "NHL" },
  { name: "Nicklas Lidström", sport: "NHL" },
  { name: "Martin Brodeur", sport: "NHL" },
  { name: "Patrick Roy", sport: "NHL" },
  { name: "Dominik Hašek", sport: "NHL" },
  { name: "Roberto Luongo", sport: "NHL" },
  { name: "Henrik Lundqvist", sport: "NHL" },
  { name: "Marc-André Fleury", sport: "NHL" },
  { name: "Carey Price", sport: "NHL" },
  { name: "Brendan Shanahan", sport: "NHL" },
  { name: "Brett Hull", sport: "NHL" },
  { name: "Mike Modano", sport: "NHL" },
  { name: "Joe Nieuwendyk", sport: "NHL" },
  { name: "Joe Sakic", sport: "NHL" },
  { name: "Peter Forsberg", sport: "NHL" },
  { name: "Jaromir Jagr", sport: "NHL" },
  { name: "Teemu Selänne", sport: "NHL" },
  { name: "Mats Sundin", sport: "NHL" },
  { name: "Luc Robitaille", sport: "NHL" },
  { name: "Mike Gartner", sport: "NHL" },
  { name: "Jari Kurri", sport: "NHL" },
  { name: "Mike Bossy", sport: "NHL" },
  { name: "Bryan Trottier", sport: "NHL" },
  { name: "Denis Potvin", sport: "NHL" },
  { name: "Larry Robinson", sport: "NHL" },
  { name: "Ken Dryden", sport: "NHL" },
  { name: "Tony Esposito", sport: "NHL" },
  { name: "Phil Esposito", sport: "NHL" },
  { name: "Bobby Hull", sport: "NHL" },
  { name: "Stan Mikita", sport: "NHL" },
  { name: "Rod Gilbert", sport: "NHL" },
  { name: "Gilbert Perreault", sport: "NHL" },
  { name: "Dale Hawerchuk", sport: "NHL" },
  { name: "Doug Gilmour", sport: "NHL" },
  { name: "Pat Quinn", sport: "NHL" },
  { name: "Mike Vernon", sport: "NHL" },
  { name: "Curtis Joseph", sport: "NHL" },
  { name: "Patrick Marleau", sport: "NHL" },
  { name: "Marian Hossa", sport: "NHL" },
  { name: "Martin St. Louis", sport: "NHL" },
  { name: "Vincent Lecavalier", sport: "NHL" },
  { name: "Keith Tkachuk", sport: "NHL" },
  { name: "Brendan Morrison", sport: "NHL" },
  { name: "Markus Naslund", sport: "NHL" },
  { name: "Sergei Fedorov", sport: "NHL" },
  { name: "Pavel Datsyuk", sport: "NHL" },
  { name: "Henrik Zetterberg", sport: "NHL" },
  { name: "Nicklas Backstrom", sport: "NHL" },
  { name: "Alexander Ovechkin", sport: "NHL" },
  { name: "Evgeni Malkin", sport: "NHL" },
  { name: "Sidney Crosby", sport: "NHL" },
  { name: "Ilya Kovalchuk", sport: "NHL" },
  { name: "Pavel Bure", sport: "NHL" },
  { name: "Mats Sundin", sport: "NHL" },
  { name: "Joe Thornton", sport: "NHL" },
  { name: "Dany Heatley", sport: "NHL" },
  { name: "Jason Spezza", sport: "NHL" },
  { name: "Daniel Alfredsson", sport: "NHL" },
  { name: "Zdeno Chara", sport: "NHL" },
  { name: "Chris Pronger", sport: "NHL" },
  { name: "Scott Niedermayer", sport: "NHL" },
  { name: "Rob Blake", sport: "NHL" },
  { name: "Eric Lindros", sport: "NHL" },
  { name: "Jarome Iginla", sport: "NHL" },
  { name: "Mike Richards", sport: "NHL" },
  { name: "Jeff Carter", sport: "NHL" },
  { name: "Jonathan Toews", sport: "NHL" },
  { name: "Patrick Kane", sport: "NHL" },
  { name: "Duncan Keith", sport: "NHL" },
  { name: "Brent Seabrook", sport: "NHL" },
  { name: "Corey Crawford", sport: "NHL" },
  { name: "Ryan Getzlaf", sport: "NHL" },
  { name: "Corey Perry", sport: "NHL" },
  { name: "Claude Giroux", sport: "NHL" },
  { name: "Eric Staal", sport: "NHL" },
  { name: "Marc Staal", sport: "NHL" },
  { name: "Anze Kopitar", sport: "NHL" },
  { name: "Drew Doughty", sport: "NHL" },
  { name: "Dustin Brown", sport: "NHL" },
  { name: "Ryan Kesler", sport: "NHL" },
  { name: "Henrik Sedin", sport: "NHL" },
  { name: "Daniel Sedin", sport: "NHL" },
  { name: "Erik Karlsson", sport: "NHL" },
  { name: "Brent Burns", sport: "NHL" },
  { name: "Roman Josi", sport: "NHL" },
  { name: "John Carlson", sport: "NHL" },
  { name: "Victor Hedman", sport: "NHL" },
  { name: "Alex Pietrangelo", sport: "NHL" },
  { name: "P.K. Subban", sport: "NHL" },
  { name: "Shea Weber", sport: "NHL" },
  { name: "Dion Phaneuf", sport: "NHL" },
  { name: "John Tavares", sport: "NHL" },
  { name: "Steven Stamkos", sport: "NHL" },
  { name: "Nikita Kucherov", sport: "NHL" },
  { name: "Brayden Point", sport: "NHL" },
  { name: "Andrei Vasilevskiy", sport: "NHL" },
  { name: "Auston Matthews", sport: "NHL" },
  { name: "Mitch Marner", sport: "NHL" },
  { name: "William Nylander", sport: "NHL" },
  { name: "Connor McDavid", sport: "NHL" },
  { name: "Leon Draisaitl", sport: "NHL" },
  { name: "Nathan MacKinnon", sport: "NHL" },
  { name: "Mikko Rantanen", sport: "NHL" },
  { name: "Gabriel Landeskog", sport: "NHL" },
  { name: "Matthew Tkachuk", sport: "NHL" },
  { name: "Brady Tkachuk", sport: "NHL" },
  { name: "Elias Pettersson", sport: "NHL" },
  { name: "Quinn Hughes", sport: "NHL" },
  { name: "Cale Makar", sport: "NHL" },
  { name: "Adam Fox", sport: "NHL" },
  { name: "Moritz Seider", sport: "NHL" },
  { name: "Matvei Michkov", sport: "NHL" },
  // ── EXTENSION: NFL 50% / NBA 25% / MLB 17% / NHL 8% ─────────────────────
  // Appended after all previously-processed candidates; new batches start here.
  // NFL — QBs
  { name: "Drew Bledsoe", sport: "NFL" },
  { name: "Donovan McNabb", sport: "NFL" },
  { name: "Matt Ryan", sport: "NFL" },
  { name: "Cam Newton", sport: "NFL" },
  { name: "Kirk Cousins", sport: "NFL" },
  { name: "Matt Stafford", sport: "NFL" },
  { name: "Derek Carr", sport: "NFL" },
  { name: "Dak Prescott", sport: "NFL" },
  { name: "Kyler Murray", sport: "NFL" },
  { name: "Tua Tagovailoa", sport: "NFL" },
  { name: "Brock Purdy", sport: "NFL" },
  { name: "Ryan Tannehill", sport: "NFL" },
  { name: "Marcus Mariota", sport: "NFL" },
  { name: "Carson Palmer", sport: "NFL" },
  { name: "Bob Griese", sport: "NFL" },
  { name: "Len Dawson", sport: "NFL" },
  { name: "Kenny Stabler", sport: "NFL" },
  { name: "Y.A. Tittle", sport: "NFL" },
  { name: "Otto Graham", sport: "NFL" },
  { name: "Sid Luckman", sport: "NFL" },
  { name: "Bobby Layne", sport: "NFL" },
  { name: "Ken Anderson", sport: "NFL" },
  // NFL — RBs
  { name: "Gale Sayers", sport: "NFL" },
  { name: "Jim Taylor", sport: "NFL" },
  { name: "Franco Harris", sport: "NFL" },
  { name: "John Riggins", sport: "NFL" },
  { name: "Ricky Williams", sport: "NFL" },
  { name: "Priest Holmes", sport: "NFL" },
  { name: "Tiki Barber", sport: "NFL" },
  { name: "Clinton Portis", sport: "NFL" },
  { name: "Reggie Bush", sport: "NFL" },
  { name: "Matt Forte", sport: "NFL" },
  { name: "Jamaal Charles", sport: "NFL" },
  { name: "LeSean McCoy", sport: "NFL" },
  { name: "Eddie George", sport: "NFL" },
  { name: "Terrell Davis", sport: "NFL" },
  { name: "Herschel Walker", sport: "NFL" },
  { name: "Curtis Martin", sport: "NFL" },
  { name: "Fred Taylor", sport: "NFL" },
  { name: "Chris Johnson", sport: "NFL" },
  { name: "Ray Rice", sport: "NFL" },
  { name: "Arian Foster", sport: "NFL" },
  { name: "Jamal Lewis", sport: "NFL" },
  { name: "Jerome Bettis", sport: "NFL" },
  { name: "Roger Craig", sport: "NFL" },
  { name: "Brian Westbrook", sport: "NFL" },
  { name: "Leonard Fournette", sport: "NFL" },
  { name: "Joe Mixon", sport: "NFL" },
  { name: "Dalvin Cook", sport: "NFL" },
  { name: "Aaron Jones", sport: "NFL" },
  { name: "Josh Jacobs", sport: "NFL" },
  { name: "Bijan Robinson", sport: "NFL" },
  // NFL — WRs / TEs
  { name: "Michael Irvin", sport: "NFL" },
  { name: "Larry Fitzgerald", sport: "NFL" },
  { name: "Marvin Harrison", sport: "NFL" },
  { name: "Anquan Boldin", sport: "NFL" },
  { name: "Hines Ward", sport: "NFL" },
  { name: "Reggie Wayne", sport: "NFL" },
  { name: "Andre Johnson", sport: "NFL" },
  { name: "Dez Bryant", sport: "NFL" },
  { name: "Brandon Marshall", sport: "NFL" },
  { name: "Keyshawn Johnson", sport: "NFL" },
  { name: "Chad Johnson", sport: "NFL" },
  { name: "Wes Welker", sport: "NFL" },
  { name: "DeSean Jackson", sport: "NFL" },
  { name: "Donald Driver", sport: "NFL" },
  { name: "Greg Jennings", sport: "NFL" },
  { name: "Victor Cruz", sport: "NFL" },
  { name: "Steve Largent", sport: "NFL" },
  { name: "Art Monk", sport: "NFL" },
  { name: "James Lofton", sport: "NFL" },
  { name: "Paul Warfield", sport: "NFL" },
  { name: "John Stallworth", sport: "NFL" },
  { name: "Lynn Swann", sport: "NFL" },
  { name: "Cliff Branch", sport: "NFL" },
  { name: "Antonio Gates", sport: "NFL" },
  { name: "Dallas Clark", sport: "NFL" },
  { name: "Jeremy Shockey", sport: "NFL" },
  { name: "Dave Casper", sport: "NFL" },
  // NFL — OL
  { name: "Bruce Matthews", sport: "NFL" },
  { name: "John Hannah", sport: "NFL" },
  { name: "Gene Upshaw", sport: "NFL" },
  { name: "Randall McDaniel", sport: "NFL" },
  { name: "Alan Faneca", sport: "NFL" },
  { name: "Zack Martin", sport: "NFL" },
  { name: "Quenton Nelson", sport: "NFL" },
  // NFL — DL / pass rush
  { name: "Merlin Olsen", sport: "NFL" },
  { name: "Deacon Jones", sport: "NFL" },
  { name: "Bob Lilly", sport: "NFL" },
  { name: "Alan Page", sport: "NFL" },
  { name: "Randy White", sport: "NFL" },
  { name: "Michael Strahan", sport: "NFL" },
  { name: "Dwight Freeney", sport: "NFL" },
  { name: "Julius Peppers", sport: "NFL" },
  { name: "Khalil Mack", sport: "NFL" },
  { name: "Von Miller", sport: "NFL" },
  { name: "Kevin Greene", sport: "NFL" },
  // NFL — LBs / DBs / kickers
  { name: "Jack Ham", sport: "NFL" },
  { name: "Ted Hendricks", sport: "NFL" },
  { name: "Willie Lanier", sport: "NFL" },
  { name: "Jack Lambert", sport: "NFL" },
  { name: "Derrick Brooks", sport: "NFL" },
  { name: "Brian Urlacher", sport: "NFL" },
  { name: "Patrick Willis", sport: "NFL" },
  { name: "DeMarcus Ware", sport: "NFL" },
  { name: "Mel Blount", sport: "NFL" },
  { name: "Darrell Green", sport: "NFL" },
  { name: "Rod Woodson", sport: "NFL" },
  { name: "Richard Sherman", sport: "NFL" },
  { name: "Darrelle Revis", sport: "NFL" },
  { name: "Harrison Smith", sport: "NFL" },
  { name: "Adam Vinatieri", sport: "NFL" },
  { name: "Justin Tucker", sport: "NFL" },
  { name: "Don Hutson", sport: "NFL" },
  { name: "Raymond Berry", sport: "NFL" },
  { name: "Chuck Bednarik", sport: "NFL" },
  // NBA — era spread
  { name: "Bill Walton", sport: "NBA" },
  { name: "Willis Reed", sport: "NBA" },
  { name: "Dave Cowens", sport: "NBA" },
  { name: "Nate Archibald", sport: "NBA" },
  { name: "Rick Barry", sport: "NBA" },
  { name: "Elvin Hayes", sport: "NBA" },
  { name: "Dave Bing", sport: "NBA" },
  { name: "George Gervin", sport: "NBA" },
  { name: "Bernard King", sport: "NBA" },
  { name: "Alex English", sport: "NBA" },
  { name: "Jack Sikma", sport: "NBA" },
  { name: "Robert Parish", sport: "NBA" },
  { name: "Kevin McHale", sport: "NBA" },
  { name: "Artis Gilmore", sport: "NBA" },
  { name: "Bob McAdoo", sport: "NBA" },
  { name: "Spencer Haywood", sport: "NBA" },
  { name: "Chris Bosh", sport: "NBA" },
  { name: "Shawn Marion", sport: "NBA" },
  { name: "Peja Stojakovic", sport: "NBA" },
  { name: "Chauncey Billups", sport: "NBA" },
  { name: "Ben Wallace", sport: "NBA" },
  { name: "Rasheed Wallace", sport: "NBA" },
  { name: "Richard Hamilton", sport: "NBA" },
  { name: "Luol Deng", sport: "NBA" },
  { name: "Joakim Noah", sport: "NBA" },
  { name: "Mike Conley", sport: "NBA" },
  { name: "Zach Randolph", sport: "NBA" },
  { name: "Klay Thompson", sport: "NBA" },
  { name: "Draymond Green", sport: "NBA" },
  { name: "Derrick Rose", sport: "NBA" },
  { name: "Kevin Love", sport: "NBA" },
  { name: "Tobias Harris", sport: "NBA" },
  { name: "Gordon Hayward", sport: "NBA" },
  { name: "Kristaps Porzingis", sport: "NBA" },
  { name: "Nikola Vucevic", sport: "NBA" },
  { name: "Andrew Wiggins", sport: "NBA" },
  { name: "Karl-Anthony Towns", sport: "NBA" },
  { name: "Jaylen Brown", sport: "NBA" },
  { name: "Pascal Siakam", sport: "NBA" },
  { name: "Jaren Jackson Jr.", sport: "NBA" },
  { name: "Tyler Herro", sport: "NBA" },
  { name: "Sam Cassell", sport: "NBA" },
  { name: "Jerry Stackhouse", sport: "NBA" },
  { name: "Serge Ibaka", sport: "NBA" },
  { name: "Paul Millsap", sport: "NBA" },
  // MLB — pitchers and hitters not yet included
  { name: "Dennis Eckersley", sport: "MLB" },
  { name: "Rich Gossage", sport: "MLB" },
  { name: "Rollie Fingers", sport: "MLB" },
  { name: "John Smoltz", sport: "MLB" },
  { name: "David Cone", sport: "MLB" },
  { name: "CC Sabathia", sport: "MLB" },
  { name: "Roy Oswalt", sport: "MLB" },
  { name: "Mark Buehrle", sport: "MLB" },
  { name: "Tim Lincecum", sport: "MLB" },
  { name: "Madison Bumgarner", sport: "MLB" },
  { name: "Cole Hamels", sport: "MLB" },
  { name: "Chris Sale", sport: "MLB" },
  { name: "David Price", sport: "MLB" },
  { name: "Blake Snell", sport: "MLB" },
  { name: "Shane Bieber", sport: "MLB" },
  { name: "Jose Abreu", sport: "MLB" },
  { name: "Paul Goldschmidt", sport: "MLB" },
  { name: "Nolan Arenado", sport: "MLB" },
  { name: "Cody Bellinger", sport: "MLB" },
  { name: "Corey Seager", sport: "MLB" },
  { name: "Trea Turner", sport: "MLB" },
  { name: "Rafael Devers", sport: "MLB" },
  { name: "Yordan Alvarez", sport: "MLB" },
  { name: "Kyle Tucker", sport: "MLB" },
  { name: "Bobby Witt Jr.", sport: "MLB" },
  { name: "Pete Alonso", sport: "MLB" },
  { name: "Austin Riley", sport: "MLB" },
  { name: "Ronald Acuna Jr.", sport: "MLB" },
  { name: "Michael Brantley", sport: "MLB" },
  // NHL — notable players not yet in list
  { name: "Theo Fleury", sport: "NHL" },
  { name: "Paul Kariya", sport: "NHL" },
  { name: "Brian Leetch", sport: "NHL" },
  { name: "Al MacInnis", sport: "NHL" },
  { name: "Scott Stevens", sport: "NHL" },
  { name: "Mike Richter", sport: "NHL" },
  { name: "Adam Oates", sport: "NHL" },
  { name: "Pierre Turgeon", sport: "NHL" },
  { name: "Owen Nolan", sport: "NHL" },
  { name: "Tony Amonte", sport: "NHL" },
  { name: "Aleksander Barkov", sport: "NHL" },
  { name: "David Pastrnak", sport: "NHL" },
  { name: "Patrice Bergeron", sport: "NHL" },
  { name: "Brad Marchand", sport: "NHL" },
  { name: "Jake Guentzel", sport: "NHL" },
  { name: "Ryan Nugent-Hopkins", sport: "NHL" },
  // ── EXTENSION 2 ───────────────────────────────────────────────────────────
  // NFL — modern era with distinctive names (better Wikidata coverage)
  { name: "Michael Vick", sport: "NFL" },
  { name: "Randall Cunningham", sport: "NFL" },
  { name: "Steve McNair", sport: "NFL" },
  { name: "Daunte Culpepper", sport: "NFL" },
  { name: "Kordell Stewart", sport: "NFL" },
  { name: "Amari Cooper", sport: "NFL" },
  { name: "Odell Beckham Jr.", sport: "NFL" },
  { name: "JuJu Smith-Schuster", sport: "NFL" },
  { name: "T.Y. Hilton", sport: "NFL" },
  { name: "Vincent Jackson", sport: "NFL" },
  { name: "Eric Decker", sport: "NFL" },
  { name: "Keenan Allen", sport: "NFL" },
  { name: "Brandin Cooks", sport: "NFL" },
  { name: "Sterling Sharpe", sport: "NFL" },
  { name: "Vernon Davis", sport: "NFL" },
  { name: "Jason Witten", sport: "NFL" },
  { name: "Heath Miller", sport: "NFL" },
  { name: "Warren Sapp", sport: "NFL" },
  { name: "John Randle", sport: "NFL" },
  { name: "Terrell Suggs", sport: "NFL" },
  { name: "Osi Umenyiora", sport: "NFL" },
  { name: "LaVar Arrington", sport: "NFL" },
  { name: "Patrick Peterson", sport: "NFL" },
  { name: "Jalen Ramsey", sport: "NFL" },
  { name: "Aqib Talib", sport: "NFL" },
  { name: "Eric Berry", sport: "NFL" },
  { name: "Tyrann Mathieu", sport: "NFL" },
  { name: "Vonn Bell", sport: "NFL" },
  { name: "Kam Chancellor", sport: "NFL" },
  { name: "Earl Thomas", sport: "NFL" },
  // NBA — veterans and current stars
  { name: "Andre Iguodala", sport: "NBA" },
  { name: "Joe Johnson", sport: "NBA" },
  { name: "Jeff Teague", sport: "NBA" },
  { name: "Eric Gordon", sport: "NBA" },
  { name: "Marcus Smart", sport: "NBA" },
  { name: "OG Anunoby", sport: "NBA" },
  { name: "Mikal Bridges", sport: "NBA" },
  { name: "Dejounte Murray", sport: "NBA" },
  { name: "Tyrese Haliburton", sport: "NBA" },
  { name: "Tyrese Maxey", sport: "NBA" },
  { name: "Scottie Barnes", sport: "NBA" },
  { name: "Jordan Clarkson", sport: "NBA" },
  { name: "Harrison Barnes", sport: "NBA" },
  { name: "Goran Dragic", sport: "NBA" },
  { name: "Reggie Jackson", sport: "NBA" },
  { name: "Anfernee Simons", sport: "NBA" },
  { name: "Josh Giddey", sport: "NBA" },
  { name: "Franz Wagner", sport: "NBA" },
  { name: "Chet Holmgren", sport: "NBA" },
  { name: "Michael Redd", sport: "NBA" },
  { name: "Mo Williams", sport: "NBA" },
  { name: "Antawn Jamison", sport: "NBA" },
  { name: "Anthony Morrow", sport: "NBA" },
  // MLB — modern hitters and arms
  { name: "Jose Ramirez", sport: "MLB" },
  { name: "Marcus Semien", sport: "MLB" },
  { name: "DJ LeMahieu", sport: "MLB" },
  { name: "Alex Bregman", sport: "MLB" },
  { name: "George Springer", sport: "MLB" },
  { name: "Lance McCullers Jr.", sport: "MLB" },
  { name: "Jorge Polanco", sport: "MLB" },
  { name: "Matt Chapman", sport: "MLB" },
  { name: "Austin Riley", sport: "MLB" },
  { name: "Ronald Acuna Jr.", sport: "MLB" },
  // NHL — additional notable players
  { name: "Jordan Binnington", sport: "NHL" },
  { name: "Sebastian Aho", sport: "NHL" },
  { name: "Elias Lindholm", sport: "NHL" },
  { name: "Bo Horvat", sport: "NHL" },
  { name: "Ryan O'Reilly", sport: "NHL" },
  // ── EXTENSION 3: final push to 500 ───────────────────────────────────────
  { name: "Ja'Marr Chase", sport: "NFL" },
  { name: "Deebo Samuel", sport: "NFL" },
  { name: "Mike Evans", sport: "NFL" },
  { name: "Calvin Ridley", sport: "NFL" },
  { name: "Jaylen Waddle", sport: "NFL" },
  { name: "Zach LaVine", sport: "NBA" },
  { name: "Darius Garland", sport: "NBA" },
  { name: "Josh Hart", sport: "NBA" },
  { name: "Deni Avdija", sport: "NBA" },
  { name: "Bogdan Bogdanovic", sport: "NBA" },
  { name: "Nolan Arenado", sport: "MLB" },
  { name: "Yordan Alvarez", sport: "MLB" },
  { name: "Trea Turner", sport: "MLB" },
  // ── EXTENSION 4 ──────────────────────────────────────────────────────────
  { name: "Evan Fournier", sport: "NBA" },
  { name: "Tim Hardaway Jr.", sport: "NBA" },
  { name: "Markieff Morris", sport: "NBA" },
  { name: "Ivica Zubac", sport: "NBA" },
  { name: "Thaddeus Young", sport: "NBA" },
  { name: "Tee Higgins", sport: "NFL" },
  { name: "Chris Godwin", sport: "NFL" },
  { name: "Tyler Lockett", sport: "NFL" },
  { name: "David Njoku", sport: "NFL" },
  { name: "Darren Waller", sport: "NFL" },
];

// ── SPARQL / Commons helpers ──────────────────────────────────────────────────

async function sparql(q: string, label = "", retries = 2): Promise<any[]> {
  await sleep(SPARQL_DELAY);
  const url = `${SPARQL_EP}?query=${encodeURIComponent(q.trim())}&format=json`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      });
      if (res.status === 429 || res.status === 503 || res.status === 502) {
        if (attempt < retries) {
          const wait = 5000 * (attempt + 1);
          console.warn(`    ⚠ SPARQL ${res.status} [${label}], retrying in ${wait / 1000}s…`);
          await sleep(wait);
          continue;
        }
        const t = await res.text().catch(() => "");
        console.warn(`    ⚠ SPARQL ${res.status} [${label}] (exhausted): ${t.slice(0, 80)}`);
        return [];
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.warn(`    ⚠ SPARQL ${res.status} [${label}]: ${t.slice(0, 100)}`);
        return [];
      }
      return (await res.json()).results?.bindings ?? [];
    } catch (e: any) {
      if (attempt < retries) { await sleep(4000); continue; }
      console.warn(`    ⚠ SPARQL error [${label}]: ${e.message?.slice(0, 80)}`);
      return [];
    }
  }
  return [];
}

function p18ToFilename(url: string): string | null {
  const m = url.match(/Special:FilePath\/(.+)$/);
  return m ? decodeURIComponent(m[1]).replace(/ /g, "_") : null;
}

async function batchThumbUrls(filenames: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!filenames.length) return out;
  const B = 50;
  for (let i = 0; i < filenames.length; i += B) {
    await sleep(350);
    const batch = filenames.slice(i, i + B);
    const titles = batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|");
    const url = `${COMMONS_EP}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_W}&format=json`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const page of Object.values(data.query?.pages ?? {}) as any[]) {
        const thumb: string | undefined = page?.imageinfo?.[0]?.thumburl;
        const title: string = page?.title ?? "";
        if (thumb && title.startsWith("File:")) {
          out.set(title.slice("File:".length).replace(/ /g, "_"), thumb);
        }
      }
    } catch { /* skip */ }
  }
  return out;
}

// ── Skip-reason tracker ───────────────────────────────────────────────────────

type SkipReason =
  | "no_wikidata_entity"
  | "no_birth_year"
  | "no_nationality"
  | "no_genres"
  | "no_films"
  | "no_collaborators"
  | "no_director"
  | "no_image"
  | "no_team"
  | "no_position"
  | "no_height"
  | "db_error"
  | "inserted";

interface CandidateResult {
  name: string;
  status: SkipReason;
  detail?: string;
}

// ── Actor batch processor ─────────────────────────────────────────────────────

async function processActorBatch(names: string[]): Promise<CandidateResult[]> {
  const results: CandidateResult[] = [];
  const skip = (name: string, reason: SkipReason, detail?: string) => {
    results.push({ name, status: reason, detail });
    return null;
  };

  // Step 1: Look up QIDs for all names in one SPARQL batch
  console.log("  Step 1/6: Looking up Wikidata QIDs…");
  const valuesList = names.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");
  const qidQ = `
SELECT ?name ?entity WHERE {
  VALUES ?name { ${valuesList} }
  ?entity rdfs:label ?name .
  ?entity wdt:P106 wd:Q33999 .
  FILTER(LANG(?name) = "en")
}`;
  const qidRows = await sparql(qidQ, "qid-lookup");
  const qidMap = new Map<string, string>(); // name → QID
  for (const r of qidRows) {
    const n = r.name?.value;
    const q = r.entity?.value?.split("/").pop();
    if (n && q && !qidMap.has(n)) qidMap.set(n, q);
  }

  // Also try film actors and film directors if not found with Q33999
  const missing = names.filter((n) => !qidMap.has(n));
  if (missing.length) {
    const mv = missing.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");
    const q2 = `
SELECT ?name ?entity WHERE {
  VALUES ?name { ${mv} }
  ?entity rdfs:label ?name .
  { ?entity wdt:P106 wd:Q10800557 . } UNION
  { ?entity wdt:P106 wd:Q2405480 . } UNION
  { ?entity wdt:P106 wd:Q3282637 . }
  FILTER(LANG(?name) = "en")
}`;
    const r2 = await sparql(q2, "qid-fallback");
    for (const r of r2) {
      const n = r.name?.value;
      const q = r.entity?.value?.split("/").pop();
      if (n && q && !qidMap.has(n)) qidMap.set(n, q);
    }
  }

  for (const n of names) {
    if (!qidMap.has(n)) skip(n, "no_wikidata_entity");
  }

  const found = names.filter((n) => qidMap.has(n));
  if (!found.length) return results;
  const ids = found.map((n) => `wd:${qidMap.get(n)!}`).join(" ");

  // Step 2: Basic fields — birth, nationality, awards, yearsActive, P18 image
  console.log("  Step 2/6: Fetching basic fields (birth, nationality, image)…");
  const basicQ = `
SELECT ?entity (SAMPLE(?b) AS ?birth) (SAMPLE(?natl) AS ?nat)
       (SAMPLE(?ys) AS ?yearsStart) (SAMPLE(?img) AS ?image)
       (COUNT(DISTINCT ?award) AS ?numAwards) WHERE {
  VALUES ?entity { ${ids} }
  ?entity wdt:P569 ?b .
  OPTIONAL { ?entity wdt:P27 ?natE . ?natE rdfs:label ?natl . FILTER(LANG(?natl) = "en") }
  OPTIONAL { ?entity wdt:P166 ?award . }
  OPTIONAL { ?entity wdt:P2031 ?ys . }
  OPTIONAL { ?entity wdt:P18 ?img . }
}
GROUP BY ?entity`;
  const basicRows = await sparql(basicQ, "basic");

  type BasicData = {
    birthYear: number; nationality: string; yearsActive: number;
    majorAwards: number; imageFilename: string | null;
  };
  const basicMap = new Map<string, BasicData>();
  for (const r of basicRows) {
    const qid = r.entity?.value?.split("/").pop() ?? "";
    const birthIso = r.birth?.value ?? "";
    const birthYear = birthIso ? new Date(birthIso).getFullYear() : 0;
    const nationality = (r.nat?.value ?? "").trim();
    const yearsFrom = r.yearsStart?.value
      ? new Date(r.yearsStart.value).getFullYear()
      : birthYear + 22;
    const yearsActive = Math.max(1, CURRENT_YEAR - yearsFrom);
    const majorAwards = parseInt(r.numAwards?.value ?? "0", 10);
    const imageFilename = r.image?.value ? p18ToFilename(r.image.value) : null;
    basicMap.set(qid, { birthYear, nationality, yearsActive, majorAwards, imageFilename });
  }

  for (const name of found) {
    const qid = qidMap.get(name)!;
    const b = basicMap.get(qid);
    if (!b?.birthYear) skip(name, "no_birth_year");
    else if (!b.nationality) skip(name, "no_nationality");
  }

  const withBasic = found.filter((n) => {
    const b = basicMap.get(qidMap.get(n)!);
    return b?.birthYear && b.nationality;
  });
  if (!withBasic.length) return results;
  const basicIds = withBasic.map((n) => `wd:${qidMap.get(n)!}`).join(" ");

  // Step 3: Genres + film count
  console.log("  Step 3/6: Fetching genres and film counts…");
  const genreQ = `
SELECT ?entity (GROUP_CONCAT(DISTINCT ?gl; SEPARATOR="|") AS ?genres)
       (COUNT(DISTINCT ?film) AS ?numFilms)
       (SUM(?gross) AS ?totalGross) WHERE {
  VALUES ?entity { ${basicIds} }
  ?film wdt:P161 ?entity .
  OPTIONAL { ?film wdt:P136 ?genre . ?genre rdfs:label ?gl . FILTER(LANG(?gl) = "en") }
  OPTIONAL { ?film wdt:P2142 ?gross . }
}
GROUP BY ?entity`;
  const genreRows = await sparql(genreQ, "genres");

  type GenreData = { genres: string[]; numberOfFilms: number; totalCareerGross: bigint };
  const genreMap = new Map<string, GenreData>();
  for (const r of genreRows) {
    const qid = r.entity?.value?.split("/").pop() ?? "";
    const raw = r.genres?.value ?? "";
    const parts: string[] = raw.split("|").map((g: string) => g.trim()).filter((g: string) => Boolean(g));
    const genres: string[] = [...new Set(parts)].slice(0, 5);
    const numberOfFilms = parseInt(r.numFilms?.value ?? "0", 10);
    const totalCareerGross = BigInt(Math.round(parseFloat(r.totalGross?.value ?? "0")));
    genreMap.set(qid, { genres, numberOfFilms, totalCareerGross });
  }

  for (const name of withBasic) {
    const qid = qidMap.get(name)!;
    const g = genreMap.get(qid);
    if (!g?.genres.length) skip(name, "no_genres");
  }

  const withGenres = withBasic.filter((n) => genreMap.get(qidMap.get(n)!)?.genres.length);
  if (!withGenres.length) return results;
  const genreIds = withGenres.map((n) => `wd:${qidMap.get(n)!}`).join(" ");

  // Step 4: Collaborators (top-3 co-actors by shared film count)
  // Steps 4 & 5: Two-stage approach that guarantees each actor gets films.
  //   Stage A: One cheap query per actor to get up to 8 film QIDs (no cross-product).
  //   Stage B: One batch query for cast+director of all collected films.
  // Stage A uses 500ms delay (these queries are trivial for Wikidata).
  console.log("  Step 4/6: Fetching films (per-actor) + cast/directors (batch)…");
  const collabMap = new Map<string, string[]>();
  const dirMap = new Map<string, string>();
  const withGenresQids = withGenres.map((n) => qidMap.get(n)!);

  // Stage A: per-actor film QIDs
  const actorFilmsMap = new Map<string, string[]>(); // actor QID → film QIDs
  for (let ai = 0; ai < withGenresQids.length; ai++) {
    const aq = withGenresQids[ai];
    await sleep(500); // short delay — these are trivial single-subject queries
    const fq = `
SELECT DISTINCT ?film WHERE {
  ?film wdt:P161 wd:${aq} .
}
LIMIT 8`;
    const frows = await sparql(fq, `film-${ai}`, 1);
    const films = frows.map((r) => r.film?.value?.split("/").pop()).filter(Boolean) as string[];
    if (films.length) actorFilmsMap.set(aq, films);
    if ((ai + 1) % 10 === 0) process.stdout.write(`    ${ai + 1}/${withGenresQids.length}\r`);
  }
  console.log(`\n    Got film lists for ${actorFilmsMap.size}/${withGenresQids.length} actors`);

  // Stage B: batch cast+director for all unique films (split into chunks of 80 film IDs)
  const allFilmQids = [...new Set([...actorFilmsMap.values()].flat())];
  const filmCast = new Map<string, Set<string>>(); // film QID → co-actor names
  const filmDir  = new Map<string, string>();       // film QID → director name
  const FCHUNK = 80;

  for (let fi = 0; fi < allFilmQids.length; fi += FCHUNK) {
    const chunk = allFilmQids.slice(fi, fi + FCHUNK);
    const fids = chunk.map((f) => `wd:${f}`).join(" ");
    const castQ = `
SELECT ?film ?coname ?dirName WHERE {
  VALUES ?film { ${fids} }
  OPTIONAL { ?film wdt:P161 ?co . ?co rdfs:label ?coname . FILTER(LANG(?coname) = "en") }
  OPTIONAL { ?film wdt:P57  ?dir . ?dir rdfs:label ?dirName . FILTER(LANG(?dirName) = "en") }
}`;
    const castRows = await sparql(castQ, `cast-chunk-${Math.floor(fi / FCHUNK)}`);
    for (const r of castRows) {
      const fid = r.film?.value?.split("/").pop() ?? "";
      if (!fid) continue;
      if (r.coname?.value) {
        if (!filmCast.has(fid)) filmCast.set(fid, new Set());
        filmCast.get(fid)!.add(r.coname.value.trim());
      }
      if (r.dirName?.value && !filmDir.has(fid)) filmDir.set(fid, r.dirName.value.trim());
    }
  }

  // Aggregate: for each actor, find most frequent co-actors and director
  for (const aq of withGenresQids) {
    const films = actorFilmsMap.get(aq) ?? [];
    const coFreq = new Map<string, number>();
    const drFreq = new Map<string, number>();
    for (const fid of films) {
      for (const co of filmCast.get(fid) ?? new Set()) coFreq.set(co, (coFreq.get(co) ?? 0) + 1);
      const d = filmDir.get(fid);
      if (d) drFreq.set(d, (drFreq.get(d) ?? 0) + 1);
    }
    const top3 = [...coFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    const topDir = [...drFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    if (top3.length) collabMap.set(aq, top3);
    if (topDir) dirMap.set(aq, topDir);
  }
  console.log(`    collabs resolved for ${collabMap.size} actors`);

  for (const name of withGenres) {
    const qid = qidMap.get(name)!;
    if (!collabMap.get(qid)?.length) skip(name, "no_collaborators");
  }

  const withCollabs = withGenres.filter((n) => collabMap.get(qidMap.get(n)!)?.length);
  if (!withCollabs.length) return results;
  const collabIds = withCollabs.map((n) => `wd:${qidMap.get(n)!}`).join(" ");

  // Step 5: director skips (already fetched in step 4)
  console.log("  Step 5/6: Checking directors (fetched in step 4)…");

  for (const name of withCollabs) {
    const qid = qidMap.get(name)!;
    if (!dirMap.has(qid)) skip(name, "no_director");
  }

  const withDir = withCollabs.filter((n) => dirMap.has(qidMap.get(n)!));
  if (!withDir.length) return results;

  // Step 6: Resolve images (actors + all collab/director names via P18)
  console.log("  Step 6/6: Resolving images…");

  // Actor images: already have filenames from basic query
  const actorFilenames = [...new Set(
    withDir.map((n) => basicMap.get(qidMap.get(n)!)?.imageFilename).filter(Boolean) as string[]
  )];

  // Collab/director images: look up by name
  const personNames = [...new Set(
    withDir.flatMap((n) => {
      const qid = qidMap.get(n)!;
      return [...(collabMap.get(qid) ?? []), dirMap.get(qid) ?? ""].filter(Boolean);
    })
  )];

  // Batch P18 by name for collabs/directors (chunks of 80)
  const personFilenameMap = new Map<string, string>();
  const PCHUNK = 80;
  for (let i = 0; i < personNames.length; i += PCHUNK) {
    const chunk = personNames.slice(i, i + PCHUNK);
    const vl = chunk.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");
    const pq = `
SELECT ?name (SAMPLE(?img) AS ?image) WHERE {
  VALUES ?name { ${vl} }
  ?entity rdfs:label ?name . ?entity wdt:P18 ?img .
  FILTER(LANG(?name) = "en")
}
GROUP BY ?name`;
    const pr = await sparql(pq, `p18-persons-${i}`);
    for (const r of pr) {
      const n = r.name?.value;
      const fn = r.image?.value ? p18ToFilename(r.image.value) : null;
      if (n && fn) personFilenameMap.set(n, fn);
    }
  }

  const allFilenames = [...new Set([...actorFilenames, ...personFilenameMap.values()])];
  const thumbMap = await batchThumbUrls(allFilenames);
  console.log(`    ${thumbMap.size}/${allFilenames.length} thumbnails resolved`);

  const getThumb = (fn: string | null | undefined): string | null =>
    fn ? (thumbMap.get(fn) ?? null) : null;

  // Step 7: DB insert
  for (const name of withDir) {
    const qid = qidMap.get(name)!;
    const b = basicMap.get(qid)!;
    const g = genreMap.get(qid)!;
    const collabs = (collabMap.get(qid) ?? []).map((cn) => ({
      name: cn, imageUrl: getThumb(personFilenameMap.get(cn) ?? null),
    }));
    const dirName = dirMap.get(qid)!;
    const director = { name: dirName, imageUrl: getThumb(personFilenameMap.get(dirName) ?? null) };
    const imageUrl = getThumb(b.imageFilename);

    if (!imageUrl) {
      results.push({ name, status: "no_image" });
      continue;
    }

    try {
      const data = {
        name, birthYear: b.birthYear, nationality: b.nationality,
        yearsActive: b.yearsActive, genres: g.genres, numberOfFilms: g.numberOfFilms,
        majorAwards: b.majorAwards, totalCareerGross: g.totalCareerGross,
        avgCriticScore: 0, imageUrl,
        collaborators: collabs as any, director: director as any,
      };
      await prisma.actor.upsert({ where: { name }, update: data, create: data });
      results.push({ name, status: "inserted" });
    } catch (e: any) {
      results.push({ name, status: "db_error", detail: e.message?.slice(0, 80) });
    }
  }

  return results;
}

// ── Athlete batch processor ───────────────────────────────────────────────────

async function processAthleteBatch(
  candidates: Array<{ name: string; sport: string }>
): Promise<CandidateResult[]> {
  const results: CandidateResult[] = [];
  const skip = (name: string, reason: SkipReason, detail?: string) => {
    results.push({ name, status: reason, detail });
  };

  // Occupation QIDs by sport (fallbacks)
  const SPORT_OCCUPATION: Record<string, string> = {
    NBA: "Q3665646",   // basketball player
    NFL: "Q19204627",  // American football player
    MLB: "Q3665646",   // (reuse, will filter by sport)
    NHL: "Q22279563",  // ice hockey player
  };
  // Sport QIDs
  const SPORT_QID: Record<string, string> = {
    NBA: "Q5372", NFL: "Q41323", MLB: "Q5849", NHL: "Q41328",
  };

  const names = candidates.map((c) => c.name);
  const sportMap = new Map(candidates.map((c) => [c.name, c.sport]));

  // Step 1: QID lookup (try sport property first, then occupation)
  // Use wbsearchentities (name-search API) instead of SPARQL for QID lookup —
  // the SPARQL sport/occupation filter approach fails for MLB/NHL because those
  // sport P641 QIDs vary across Wikidata entities. The search API finds entities
  // by name regardless of how properties are tagged.
  console.log("  Step 1/3: Looking up Wikidata QIDs via search API…");
  const qidMap = new Map<string, string>();
  for (let ni = 0; ni < names.length; ni++) {
    const name = names[ni];
    await sleep(400);
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
        `&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const data: any = await res.json();
        const qid: string | undefined = data.search?.[0]?.id;
        if (qid) qidMap.set(name, qid);
      }
    } catch { /* skip */ }
    if ((ni + 1) % 10 === 0) process.stdout.write(`    ${ni + 1}/${names.length}\r`);
  }
  console.log(`\n    Found ${qidMap.size}/${names.length} QIDs`);

  for (const c of candidates) {
    if (!qidMap.has(c.name)) skip(c.name, "no_wikidata_entity");
  }

  const found = candidates.filter((c) => qidMap.has(c.name));
  if (!found.length) return results;
  const ids = found.map((c) => `wd:${qidMap.get(c.name)!}`).join(" ");

  // Step 2: Batch fetch all fields
  console.log("  Step 2/3: Fetching fields (birth, team, position, height, image)…");
  const detQ = `
SELECT ?entity (SAMPLE(?b) AS ?birth) (SAMPLE(?team) AS ?teamName)
       (SAMPLE(?pos) AS ?position) (SAMPLE(?h) AS ?height)
       (SAMPLE(?ys) AS ?yearsStart) (SAMPLE(?ye) AS ?yearsEnd)
       (SAMPLE(?img) AS ?image) WHERE {
  VALUES ?entity { ${ids} }
  ?entity wdt:P569 ?b .
  OPTIONAL {
    ?entity wdt:P54 ?t .
    ?t rdfs:label ?team . FILTER(LANG(?team) = "en")
  }
  OPTIONAL {
    ?entity wdt:P413 ?p .
    ?p rdfs:label ?pos . FILTER(LANG(?pos) = "en")
  }
  OPTIONAL { ?entity wdt:P2048 ?h . FILTER(?h > 100) }
  OPTIONAL { ?entity wdt:P2031 ?ys . }
  OPTIONAL { ?entity wdt:P2032 ?ye . }
  OPTIONAL { ?entity wdt:P18 ?img . }
}
GROUP BY ?entity`;
  const detRows = await sparql(detQ, "ath-details");

  type AthData = {
    birthYear: number; team: string; position: string;
    heightCm: number; yearsActive: number; imageFilename: string | null;
  };
  const detMap = new Map<string, AthData>();
  for (const r of detRows) {
    const qid = r.entity?.value?.split("/").pop() ?? "";
    const birthYear = r.birth?.value ? new Date(r.birth.value).getFullYear() : 0;
    const team = (r.teamName?.value ?? "").trim() || "Unknown";
    const position = (r.position?.value ?? "").trim() || "Unknown";
    const heightCm = Math.round(parseFloat(r.height?.value ?? "0"));
    const careerStart = r.yearsStart?.value ? new Date(r.yearsStart.value).getFullYear() : 0;
    const careerEnd = r.yearsEnd?.value ? new Date(r.yearsEnd.value).getFullYear() : CURRENT_YEAR;
    const yearsRaw = careerStart ? Math.max(1, Math.min(careerEnd, CURRENT_YEAR) - careerStart) : 10;
    // Cap at 40 — longer values are almost always bad data (e.g., birth year used as career start)
    const yearsActive = yearsRaw > 40 ? 20 : yearsRaw;
    const imageFilename = r.image?.value ? p18ToFilename(r.image.value) : null;
    detMap.set(qid, { birthYear, team, position, heightCm, yearsActive, imageFilename });
  }

  // Step 3: Images + insert
  console.log("  Step 3/3: Resolving images and inserting…");
  const filenames = [...new Set(
    found.map((c) => detMap.get(qidMap.get(c.name)!)?.imageFilename).filter(Boolean) as string[]
  )];
  const thumbMap = await batchThumbUrls(filenames);
  console.log(`    ${thumbMap.size}/${filenames.length} thumbnails resolved`);

  for (const c of found) {
    const qid = qidMap.get(c.name)!;
    const d = detMap.get(qid);
    if (!d?.birthYear) { skip(c.name, "no_birth_year"); continue; }

    const imageUrl = d.imageFilename ? (thumbMap.get(d.imageFilename) ?? null) : null;
    if (!imageUrl) { skip(c.name, "no_image"); continue; }
    if (!d.heightCm) { skip(c.name, "no_height"); continue; }

    try {
      await prisma.athlete.upsert({
        where: { name: c.name },
        update: {
          birthYear: d.birthYear, sport: c.sport, team: d.team,
          position: d.position, heightCm: d.heightCm, yearsActive: d.yearsActive,
          allStarSelections: 0, imageUrl,
        },
        create: {
          name: c.name, birthYear: d.birthYear, sport: c.sport, team: d.team,
          position: d.position, heightCm: d.heightCm, yearsActive: d.yearsActive,
          allStarSelections: 0, imageUrl,
        },
      });
      results.push({ name: c.name, status: "inserted" });
    } catch (e: any) {
      results.push({ name: c.name, status: "db_error", detail: e.message?.slice(0, 80) });
    }
  }

  return results;
}

// ── Report ────────────────────────────────────────────────────────────────────

function printReport(pool: string, batchN: number, results: CandidateResult[]) {
  const inserted = results.filter((r) => r.status === "inserted");
  const skipped = results.filter((r) => r.status !== "inserted");

  const byReason: Record<string, string[]> = {};
  for (const r of skipped) {
    if (!byReason[r.status]) byReason[r.status] = [];
    byReason[r.status].push(r.name);
  }

  console.log(`\n${"═".repeat(54)}`);
  console.log(`  ${pool.toUpperCase()} — Batch ${batchN} results`);
  console.log("═".repeat(54));
  console.log(`  ✓ Inserted:  ${inserted.length}`);
  console.log(`  ✗ Skipped:   ${skipped.length}`);
  if (Object.keys(byReason).length) {
    console.log("\n  Skip breakdown:");
    for (const [reason, names] of Object.entries(byReason)) {
      console.log(`    ${reason.padEnd(22)} ${names.length}× — ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}`);
    }
  }
  if (inserted.length) {
    console.log(`\n  Inserted (first 10):`);
    inserted.slice(0, 10).forEach((r) => console.log(`    • ${r.name}`));
    if (inserted.length > 10) console.log(`    … and ${inserted.length - 10} more`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const start = BATCH * BATCH_SIZE;
  const end = start + BATCH_SIZE;

  if (POOL === "actors") {
    const total = ACTOR_CANDIDATES.length;
    const batch = ACTOR_CANDIDATES.slice(start, end);
    if (!batch.length) {
      console.log(`No more actor candidates (list has ${total}, batch ${BATCH} starts at ${start}).`);
      process.exit(0);
    }
    console.log(`\nActors — batch ${BATCH} (${start + 1}–${Math.min(end, total)} of ${total})`);
    console.log(`Candidates: ${batch.join(", ").slice(0, 120)}…\n`);
    const results = await processActorBatch(batch);
    printReport("actors", BATCH, results);

    const dbTotal = await prisma.actor.count();
    const dbImages = await prisma.actor.count({ where: { imageUrl: { not: null } } });
    console.log(`\n  DB totals → ${dbTotal} actors, ${dbImages} with images`);
    const nextBatch = BATCH + 1;
    if (end < total) {
      console.log(`\n  Next: npx tsx scripts/ingestBatch.ts --pool actors --batch ${nextBatch}`);
    } else {
      console.log("\n  All actor candidates processed.");
    }
  } else {
    const total = ATHLETE_CANDIDATES.length;
    const batch = ATHLETE_CANDIDATES.slice(start, end);
    if (!batch.length) {
      console.log(`No more athlete candidates (list has ${total}, batch ${BATCH} starts at ${start}).`);
      process.exit(0);
    }
    console.log(`\nAthletes — batch ${BATCH} (${start + 1}–${Math.min(end, total)} of ${total})`);
    console.log(`Candidates: ${batch.map((c) => c.name).join(", ").slice(0, 120)}…\n`);
    const results = await processAthleteBatch(batch);
    printReport("athletes", BATCH, results);

    const dbTotal = await prisma.athlete.count();
    const dbImages = await prisma.athlete.count({ where: { imageUrl: { not: null } } });
    console.log(`\n  DB totals → ${dbTotal} athletes, ${dbImages} with images`);
    const nextBatch = BATCH + 1;
    if (end < total) {
      console.log(`\n  Next: npx tsx scripts/ingestBatch.ts --pool athletes --batch ${nextBatch}`);
    } else {
      console.log("\n  All athlete candidates processed.");
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
