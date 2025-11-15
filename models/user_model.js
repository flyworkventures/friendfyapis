class UserModel {
    constructor(
        id,
        email,
        phoneNumber,
        password,
        token,
        accountCreatedDate,
        memberShip,
        ownAgent,
        credential, // email , google , apple
        lastLogins, // array
        ips, // array
        verificated // bool
    ) {
        this.id = id;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.password = password;
        this.token = token;
        this.accountCreatedDate = accountCreatedDate;
        this.memberShip = memberShip;
        this.ownAgent = ownAgent;
        this.credential = credential,
        this.lastLogins = lastLogins,
        this.ips = ips,
        this.verificated = verificated

    }
}

module.exports = UserModel;