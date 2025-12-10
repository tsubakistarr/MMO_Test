class Player
	attr_reader :username, :socket, :level, :max_health, :health, :attack, :defense, :total_experience, :remaining_experience_required_levelup, :total_experience_required_levelup
	attr_accessor :location, :defending, :in_fight, :player_turn, :target_player
	EXP_GROWTH_RATE = 1.1

	def initialize(username, socket, location)
		@username = username
		@socket = socket
		@location = location
		@level = 1
		@max_health = 30
		@health = 30
		@attack = 15
		@defense = 5
		@defending = false
		@in_fight = false
		@player_turn = true
		@total_experience = 0.0
		@remaining_experience_required_levelup = 100.0
		@total_experience_required_levelup = 100.0
		@target_player = nil
	end
	def level_up
		@level += 1
		@max_health += 5
		@health = @max_health
		@attack += 2
		@defense += 1
	end
	def take_damage(damage)
	    damage_taken = [0, damage - @defense].max
	    damage_taken /= 2 if @defending
	    @health -= damage_taken
	    @defending = false
	    return damage_taken 
	end
	def alive?
		@health > 0
	end
	def heal
		heal_amount = (@max_health * 0.20).to_i
  		@health += heal_amount
  		@health = [@health, @max_health].min
  		return heal_amount
	end
	def full_heal
		@health = @max_health
	end
	def add_experience(level)
		experience_to_add = (level.to_f / @level) * 10 * (1 + (level * 0.1))
		@total_experience += experience_to_add
		@remaining_experience_required_levelup -= experience_to_add
		if @remaining_experience_required_levelup <= 0
			excess_experience = @remaining_experience_required_levelup.abs
			level_up()
			@total_experience_required_levelup = (@total_experience_required_levelup * EXP_GROWTH_RATE)
			@remaining_experience_required_levelup = @total_experience_required_levelup - excess_experience
		end
		return experience_to_add
	end
end