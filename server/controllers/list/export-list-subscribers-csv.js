const List = require('../../models').list;
const ListSubscriber = require('../../models').listsubscriber;

const listPermission = require('../permissions/acl-lib/acl-list-permissions');

module.exports = (req, res) => {
  // Find all subscribers belonging to a list

  const filters = JSON.parse(req.query.filters) || {};
  const listId = req.query.listId;
  let userId = '';

  const access = listPermission(req.cookies.user, req.user.id)
    .then(userIdAndLists => {
      // userIdAndCampaigns.lists must not equal 'None'
      if (userIdAndLists.lists === 'None') {
        throw 'Permission denied';
      } else {
        userId = userIdAndLists.userId;
        return null;
      }
    });

  Promise.all([access])
    .then(() => {

    List.findOne({
      where: {
        userId,
        id: listId
      },
      attributes: ['id'],
      raw: true
    }).then(list => {
      if (!list) {
        res.status(401)  //??
          .send({
            message: 'not authorised to view list or list does not exist'
          });
      } else {
        // Request headers
        res.setHeader('Content-disposition', 'attachment; filename=listsubscribers.csv');
        res.setHeader('Content-type', 'text/csv');

        // CSV file header row
        res.write('email,subscribed,mostrecentstatus\n');

        // Construct filter query
        let where = { listId };
        if (filters.subscribed === 'true') {
          where.subscribed = true;
        } else if (filters.subscribed === 'false') {
          where.subscribed = false;
        }
        const statusFilters = ['bounce:permanent', 'bounce:transient', 'bounce:undetermined', 'complaint', 'unconfirmed'];
        if (statusFilters.includes(filters.mostRecentStatus)) {
          where.mostRecentStatus = filters.mostRecentStatus;
        }

        sendSubscribers();

        function sendSubscribers(offset=0, limit=10000) {  // limit is how many rows to hold in memory
          ListSubscriber.findAll({
            where,
            offset,
            limit,
            attributes: ['email', 'subscribed', 'mostRecentStatus']
          }).then(listSubscribers => {
            if (listSubscribers.length) {
              let chunk = '';

              // Build csv rows from the data
              listSubscribers.forEach(listSubscriber => {
                const result = listSubscriber.dataValues;
                chunk += `${result.email},${result.subscribed},${result.mostRecentStatus}\n`;
              });

              // Make sure that the response buffer is empty before fetching and sending more
              // rows. Otherwise we will run out of memory by filling up the buffer
              if (res.write(chunk)) {
                sendSubscribers(offset + limit);
              } else {
                res.once('drain', () => {
                  sendSubscribers(offset + limit);
                });
              }
            } else {
              res.end();
              return;
            }
          });
        }
      }
    });
  });
};
