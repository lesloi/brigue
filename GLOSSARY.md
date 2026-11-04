# Glossary

The town speaks French; the code and the docs speak English. This is the bridge. A term stays in
French in the data and in the interface, and the English here is only how we talk about it.

## The town

- **Maison** — a house: one family, its money, its title, its workshops, its grudges. The unit a
  player controls, and the unit the simulation knows as a place.
- **Personnage** — the current member of the house. Holds the career and the attributes, ages,
  dies, and is replaced by an heir.
- **Ville** — the town, Saint-Aubin. One world, shared by every house; twenty houses at most.
- **Semaine** — the tick. One game week, one real hour; twenty-four weeks make a year, and a year
  is a day.
- **An** — twenty-four weeks, one real day. The calendar advances a year per day.
- **Place** — a seat or a house as something the town can assign: a house is held by a controller
  (`ai` or `human`), a seat by a person.

## The council

- **Charge** — an office. A seat on the council, with a right attached.
- **Maire** — the mayor. Presides, sets the agenda, hears appeals, sets the sales and guild taxes.
- **Prévôt** — the provost. Opens investigations, seizes goods, holds the watch, defines crimes.
- **Échevin du ban** — the alderman of the ban. One of them; fixes the price of grain, wool and
  cloth, and the rents.
- **Maître de la halle** — the master of the hall. Grants places, holds the cloth seal, weighs and
  measures.
- **Trésorier** — the treasurer. Sets the succession duty, the income level and usury, and keeps
  the chest.
- **Greffier** — the clerk. Keeps the record, admits or refuses a complaint, examines the
  authenticity of evidence.
- **Crieur** — the herald. Publishes the ban, defines libel, carries the rumours.
- **Jurat**, **Marguillier** — the five seats without a lever: salary, prestige, a vote on
  exceptional measures, and jury duty.
- **Carrière** — the offices a person has held. It gates the floor they may stand for, and it dies
  with them.
- **Titre** — the house's rank, from roturier to prince. Bought, lost by a court or by death.
- **Faveur** — favour: the standing that makes a house electable. Earned by service, lost by
  offence.
- **Prestige** — prestige: what the town thinks of the house, and what caps the residence.
- **Camp** — a faction: houses that vote together, for now.

## The law

- **Ban** — a proclamation fixing a price or forbidding a trade. Enforced from the next week.
- **Domaine** — the set of laws an office fixes alone, without a vote.
- **Mesure** — an exceptional decision the council votes: a work, a loan, a recoinage, an amnesty,
  a requisition, the gates, an ennoblement.
- **Greffe** — the clerk's office: acts, complaints, evidence, the record of what was decided.
- **Loi** — a law in force, always with the house that carried it.
- **Séance** — a sitting of the council, where the exceptional measures are voted.
- **Jury** — five houses drawn at random, excluding the parties, voting in secret.
- **Preuve** — a piece of evidence. It can be destroyed, hidden or forged; a forged proof is a
  crime.
- **Peine** — the sentence: a fine, the loss of a title, prison, exile.

## Money and goods

- **Écu** — the coin the player counts in. Stored in the code as integer cents; one écu is 100
  cents.
- **Denier** — a unit of account worth ten cents, used in laws and taxes. A convention of the
  town, not a coin: it exists so a tax can be written as "one denier a piece" without introducing
  a fraction of a cent.
- **Halle** — the market hall, where cloth is sold and where a place must be granted.
- **Sceau** — the seal that certifies cloth; also the drawn mark of a place on the map.
- **Drap** — cloth, the good of the opening trade.
- **Laine** — wool, the raw material.
- **Blé** — grain, the good whose price the aldermen fix.
- **Entrepôt** — the warehouse: finished goods, with a capacity fixed by the workshop's level.

## The person

- **Attributs** — artisanat, parole, intrigue. Raised by use, capped by the trade and the title,
  and lost with the person.
- **Héritier** — the next person of the house. Chosen at retirement; taken, unprepared, by death.
- **Retraite** — the clean handover at fifty, chosen by the player. It keeps the estate and
  prepares the heir; refusing it opens the window in which death may come.
- **Rancune** — a line in a house's register: who beat it, who denounced it, who robbed it, who
  testified against it. The heir keeps it, because the enemies survive the person.
