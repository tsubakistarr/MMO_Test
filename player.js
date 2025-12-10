class Player {
	#username;
	#socket;
	#level;
	#maxHealth;
	#health;
	#attack;
	#defense;
	#totalExperience;
	#remainingExperienceRequiredLevelup;
	#totalExperienceRequiredLevelup;
	location;
	defending;
	inFight;
	playerTurn;
	targetPlayer;
	static EXP_GROWTH_RATE = 1.1;

	constructor(username, socket, location){
		this.#username = username;
		this.#socket = socket;
		this.location = location;
		this.#level = 1;
		this.#maxHealth = 30;
		this.#health = 30;
		this.#attack = 15;
		this.#defense = 5;
		this.defending = false;
		this.inFight = false;
		this.playerTurn = true;
		this.#totalExperience = 0.0;
		this.#remainingExperienceRequiredLevelup = 100.0;
		this.#totalExperienceRequiredLevelup = 100.0;
		this.targetPlayer = null;
	}

	get username(){ return this.#username; }
	get socket(){ return this.#socket; }
	get level(){ return this.#level; }
	get maxHealth(){ return this.#maxHealth; }
	get health(){ return this.#health; }
	get attack(){ return this.#attack; }
	get defense(){ return this.#defense; }
	get totalExperience(){ return this.#totalExperience }
	get remainingExperienceRequiredLevelup(){ return this.#remainingExperienceRequiredLevelup }
	get totalExperienceRequiredLevelup(){ return this.#totalExperienceRequiredLevelup }

	levelUp(){
		this.#level += 1;
		this.#maxHealth += 5;
		this.#health = this.#maxHealth;
		this.#attack += 2;
		this.#defense += 1;
	}

	takeDamage(damage){
		let damageTaken = Math.max(0, damage - this.#defense);
		if (this.defending){
			damageTaken /= 2;
		}
		this.#health -= damageTaken;
		this.defending = false;
		return damageTaken
	}

	isAlive(){
		return this.#health > 0;
	}

	heal(){
		let healAmount = parseInt(this.maxHealth * 0.20);
		this.#health += healAmount;
		this.#health = Math.min(this.#health, this.#maxHealth);
		return healAmount;
	}

	fullHeal(){
		this.#health = this.#maxHealth;
	}

	addExperience(level){
		let experienceToAdd = (parseFloat(level) / this.#level) * 10 * (1 + (level * 0.1));
		this.#totalExperience += experienceToAdd;
		this.#remainingExperienceRequiredLevelup -= experienceToAdd;
		if(this.#remainingExperienceRequiredLevelup <= 0){
			let excessExperience = Math.abs(this.#remainingExperienceRequiredLevelup);
			this.levelUp();
			this.#totalExperienceRequiredLevelup = this.#totalExperienceRequiredLevelup * Player.EXP_GROWTH_RATE;
			this.#remainingExperienceRequiredLevelup = this.#totalExperienceRequiredLevelup - excessExperience;
		}
		return experienceToAdd;
	}
}
module.exports = Player;