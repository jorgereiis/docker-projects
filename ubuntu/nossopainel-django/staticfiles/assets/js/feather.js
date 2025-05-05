
// feather

(function (){

    feather.replace()


})();



// loader

$(document).ajaxStart(function() {
    $("#loader").show();
}).ajaxStop(function() {
    $("#loader").hide();
});

