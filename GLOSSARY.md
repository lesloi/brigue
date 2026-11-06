# Glossary

The town speaks French; the code and the docs speak English. This is the bridge. A term stays in
French in the data and in the interface, and the English here is only how we talk about it.

## The town

- **Maison** — a house: one family, its money, its title, its workshops, its grudges. The unit a
  player controls, and the unit the simulation knows as a place.
- **Fondateur** — the first house of the town. Not a political role: no seat, no vote, no special
  trade; it only differs in its starting kit.
- **Fournisseur** — an AI house that produces a raw good: wool, grain or wood. Permanent, and
  never replaced by a human.
- **Personnage** — the current member of the house. Holds the attributes, ages,
  dies, and is replaced by an heir.
- **Ville** — the town, Saint-Aubin. Twenty houses at most, and the lowest tier of government.
- **Comté** — the county: several towns, one council, one comte. Above the town.
- **Royaume** — the kingdom: several counties, one council, one king. The highest tier.
- **Heure** — the clock. One real hour is half a town month; twenty-four hours make a year, and a
  year is a day. A duration is said in hours when planning, in months when the town speaks.
- **Mois** — two real hours; twelve months make a year.
- **An** — twenty-four real hours, one day. The calendar advances a year per day.
- **Place** — a seat or a house as something the town can assign: a house is held by a controller
  (`ai` or `human`), a seat by a person.
- **Dormance** — the state of a house whose player has stopped playing: it keeps its money and its
  grudges, nothing runs, it stands for nothing and holds no office. After thirty days, the house
  is deleted.

## The council

- **Charge** — an office. A seat on the council, with a right attached.
- **Maire** — the mayor. Presides, sets the agenda, hears appeals, sets the sales and guild taxes.
  The head of the town, and the lowest tier of the ladder.
- **Comte** — the count. The head of a county: the company, the roads, the appeal against a town.
- **Roi** — the head of the kingdom. The coin belongs to the kingdom's own officers, not to his
  day. Crowned, he reigns one real day, and then the town closes.
- **Prévôt** — the provost. Opens investigations, seizes goods, holds the watch, defines crimes.
- **Échevin du ban** — the alderman of the ban. One of them; fixes the prices of the town's goods,
  and the rents.
- **Maître de la halle** — the master of the hall. Grants places, holds the cloth seal, weighs and
  measures.
- **Trésorier** — the treasurer. Sets the succession duty, the income level and usury, and keeps
  the chest.
- **Greffier** — the clerk. Keeps the record, admits or refuses a complaint, exposes a forged
  proof automatically.
- **Crieur** — the herald. Publishes the ban, defines libel, carries the rumours.
- **Jurat**, **Marguillier** — the five seats without a lever: salary, prestige, a vote on
  exceptional measures, and jury duty.
- **Carrière** — the offices a house has held. It gates the floor of the pyramid the house may
  stand for, and it falls one floor at death.
- **Titre** — the house's rank, from roturier to prince. Bought at the town hall, lost by a court
  or by death.
- **Faveur** — favour: the standing that makes a house electable. Earned by service (a mandate, a
  jury, a vote with the winner) and by visible spending (a gift, a work, a banquet); lost by
  offence.
- **Prestige** — prestige: what the town thinks of the house; the residence level caps it.
- **Livre des rois** — the clerk's record of the crowned kings: their player, house, person, day
  and the time it took, kept across towns.

## The law

- **Ban** — a proclamation fixing a price or forbidding a trade. Enforced from the next midnight.
- **Domaine** — the set of laws an office fixes alone, without a vote.
- **Mesure** — an exceptional decision the council votes: a work, a loan, an amnesty, a
  requisition, the gates.
- **Greffe** — the clerk's office: acts, complaints, evidence, the record of what was decided.
- **Loi** — a law in force, always with the house that carried it.
- **Séance** — a sitting of the council, where the exceptional measures are voted.
- **Jury** — five houses drawn at random, excluding the parties, voting in secret.
- **Juge** — the office that did not investigate the case; he does not vote, he fixes the sentence
  and breaks a tie.
- **Gravité** — the provost places each crime at minor, medium or serious; the penalty follows
  (five per cent and a day, ten and two, twenty and three).
- **Pot-de-vin** — money and intrigue to make an officer look away for a few hours; discovered, it
  is a crime for both.
- **Preuve** — a piece of evidence. It can be destroyed, hidden or forged; a forged proof is a
  crime, and the clerk in office exposes it automatically.
- **Peine** — the sentence: a fine, the loss of a title degree, or prison. A medium sentence is two
  days and a tenth of the estate; there is no exile.
- **Prison** — a political death, not a pause: the prisoner keeps his house and his trade, but
  cannot stand, vote, judge or buy a title, and his office is suspended until the next election.

## Money and goods

- **Écu** — the coin the player counts in. Stored in the code as integer cents; one écu is 100
  cents.
- **Denier** — a unit of account worth ten cents, used in laws and taxes. A convention of the
  town, not a coin: it exists so a tax can be written as "one denier a piece" without introducing
  a fraction of a cent.
- **Halle** — the market hall, where goods are sold and where a place must be granted.
- **Sceau** — the seal that certifies cloth; also the drawn mark of a place on the map.
- **Sceau de saison** — the instant a season closes: the crowned king enters the book of kings,
  and the town is gone.
- **Drap** — cloth, the good of chapter I.
- **Laine** — wool, the raw material of cloth.
- **Blé** — grain, the raw material of bread.
- **Pain** — bread, the good the town eats.
- **Bois** — wood, the raw material of planks.
- **Planche** — plank, the good the town builds with.
- **Entrepôt** — the warehouse: finished goods, with a capacity fixed by the house's residence
  level.

## The person

- **Attributs** — artisanat, parole, intrigue. Raised by use, capped by the trade and the title,
  and lost with the person.
- **Métier** — the trade a player chooses at creation: weaver, baker, carpenter. One at a time;
  another can be learned, which converts the workshop.
- **Résidence** — the house's one ladder: the title opens a level, money pays for it, and the level
  sets the prestige cap, the defence of the stock, the capacity and the number of workshops.
- **Héritier** — the next person of the house. Chosen at retirement; taken, unprepared, by death.
- **Retraite** — the clean handover at fifty, chosen by the player. It keeps the estate and
  prepares the heir; refusing it opens the window in which death may come.
- **Rancune** — a line in a house's register: who beat it, who denounced it, who robbed it, who
  testified against it. The heir keeps it, because the enemies survive the person.

## Identity

- **Compte joueur** — the player's key to a house, called a token in the code: an opaque secret,
  shown once, with no email, no password and no recovery. A reset never invalidates it: it takes
  the house and keeps the account, and the next visit asks for a trade again. Lost, the house is
  lost.
